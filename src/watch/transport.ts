import { db } from '@/db/db';
import { WatchLink, watchLinkSupported } from '@/utils/watchLink';
import {
  applyWatchCommand,
  createWatchSnapshot,
  WATCH_SELECTED_KEY,
  WATCH_EPOCH_KEY,
  WATCH_CONTROL_KEY,
} from './sessionSync';
import { packet, watchCommandSchema } from './protocol';
import type { WatchSnapshot } from './protocol';
import { watchRecoveryActions } from './recovery';

export interface WatchSelection {
  sessionId: string;
  epoch: string;
  snapshotId: string;
  revision?: number;
  confirmed?: boolean;
  owner?: 'watch' | 'pausing' | 'phone' | 'closed';
  controlId?: string;
  offline?: boolean;
  restTransfer?: { id: string; seconds: number };
}

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => {});
  return result;
}
let draining: Promise<void> | null = null;
export async function watchSelection(): Promise<WatchSelection | undefined> {
  return (await db.meta.get(WATCH_SELECTED_KEY))?.value as WatchSelection | undefined;
}
async function nextControlRevision(): Promise<number> {
  return db.transaction('rw', db.meta, async () => {
    const value = Number((await db.meta.get(WATCH_CONTROL_KEY))?.value ?? 0) + 1;
    await db.meta.put({ key: WATCH_CONTROL_KEY, value });
    return value;
  });
}
async function sendControl(
  epoch: string,
  sessionId: string,
  owner: 'phone' | 'closed',
): Promise<string> {
  const controlRevision = await nextControlRevision();
  const message = packet('control', { epoch, sessionId, owner, controlRevision });
  await WatchLink.controlWorkout({ packet: message });
  return message.id;
}

/** Native inbox receipt is separate from this canonical IndexedDB commit. */
export function reconcileWatchInbox(): Promise<void> {
  if (!watchLinkSupported()) return Promise.resolve();
  if (draining) return draining;
  draining = serialized(async () => {
    const report = await WatchLink.inspectWorkout();
    const ordered = report.inbox
      .map((row) => ({ row, parsed: watchCommandSchema.safeParse(row.packet.body) }))
      .sort((a, b) =>
        a.parsed.success && b.parsed.success
          ? a.parsed.data.deviceId.localeCompare(b.parsed.data.deviceId) ||
            a.parsed.data.sequence - b.parsed.data.sequence
          : 0,
      );
    for (const { row } of ordered) {
      const result = await applyWatchCommand(row.packet.id, row.packet.body);
      if (result.state === 'deferred') continue;
      await WatchLink.completeWorkoutCommand({
        peer: row.peer,
        packet: packet('result', result, row.packet.id),
      });
    }
    const selected = await watchSelection();
    const epoch = (await db.meta.get(WATCH_EPOCH_KEY))?.value;
    const published = report.published;
    if (published) {
      const body = published.body as WatchSnapshot;
      const session = await db.sessions.get(body.sessionId);
      const invalidKey = `watch:invalidated:${published.id}`;
      if (
        (!session || session.status !== 'inProgress' || body.epoch !== epoch) &&
        !(await db.meta.get(invalidKey))
      ) {
        await sendControl(body.epoch, body.sessionId, 'closed');
        await db.meta.put({ key: invalidKey, value: true });
        if (
          selected?.snapshotId === published.id ||
          (selected?.sessionId === body.sessionId && selected.epoch === body.epoch)
        ) {
          selected!.owner = 'closed';
          await db.meta.put({ key: WATCH_SELECTED_KEY, value: selected! });
        }
      }
    }
    if (selected && selected.epoch === epoch && (!selected.owner || selected.owner === 'watch')) {
      if (
        report.confirmation?.id === selected.snapshotId &&
        report.confirmation.body.state === 'received'
      ) {
        selected.confirmed = true;
        await db.meta.put({ key: WATCH_SELECTED_KEY, value: selected });
      }
      const session = await db.sessions.get(selected.sessionId);
      if (
        selected.confirmed &&
        session?.status === 'inProgress' &&
        (session.syncRevision ?? 0) !== (selected.revision ?? -1)
      ) {
        try {
          const snapshot = await createWatchSnapshot(session.id);
          await WatchLink.publishWorkout({ packet: packet('snapshot', snapshot) });
          await db.meta.put({
            key: WATCH_SELECTED_KEY,
            value: { ...selected, revision: snapshot.revision },
          });
        } catch (error) {
          console.warn('[watch] snapshot refresh waits for reconnect', error);
        }
      }
    }
    await WatchLink.flushWorkout();
  }).finally(() => {
    draining = null;
  });
  return draining;
}

export async function sendWorkoutToWatch(sessionId: string): Promise<string> {
  if (!watchLinkSupported())
    throw new Error('Update the Android phone app to enable the watch connection.');
  await reconcileWatchInbox();
  return serialized(async () => {
    const selected = await watchSelection();
    if (
      selected &&
      selected.sessionId !== sessionId &&
      selected.owner !== 'phone' &&
      selected.owner !== 'closed'
    )
      throw new Error(
        'Take control of the previous workout on the phone before switching the watch.',
      );
    await nextControlRevision();
    const snapshot = await createWatchSnapshot(sessionId);
    const message = packet('snapshot', snapshot);
    await WatchLink.publishWorkout({ packet: message });
    await db.meta.put({
      key: WATCH_SELECTED_KEY,
      value: {
        sessionId,
        epoch: snapshot.epoch,
        snapshotId: message.id,
        revision: snapshot.revision,
        confirmed: false,
        owner: 'watch',
        offline: false,
      } satisfies WatchSelection,
    });
    return message.id;
  });
}

export class WatchUnavailableError extends Error {}

/** Freeze wrist mutations first, then drain through the watch's durable sequence checkpoint. */
export async function takePhoneControl(sessionId: string): Promise<void> {
  if (!watchLinkSupported()) return;
  await reconcileWatchInbox();
  const request = await serialized(async () => {
    const selected = await watchSelection();
    if (
      !selected ||
      selected.sessionId !== sessionId ||
      selected.owner === 'closed' ||
      selected.epoch !== (await db.meta.get(WATCH_EPOCH_KEY))?.value
    )
      return undefined;
    if (selected.owner === 'phone' && !selected.offline) return undefined;
    if (selected.owner === 'pausing' && selected.controlId) return selected;
    const controlId = await sendControl(selected.epoch, sessionId, 'phone');
    const next = { ...selected, owner: 'pausing' as const, controlId };
    await db.meta.put({ key: WATCH_SELECTED_KEY, value: next });
    return next;
  });
  if (!request) return;
  for (let i = 0; i < 16; i++) {
    await reconcileWatchInbox();
    const report = await WatchLink.inspectWorkout();
    const ack = report.controlConfirmation;
    if (
      ack &&
      ack.id === request.controlId &&
      ack.body.state === 'received' &&
      ack.body.deviceId &&
      Number.isSafeInteger(ack.body.sequence)
    ) {
      const last = Number(
        (await db.meta.get(`watch:sequence:${request.epoch}:${ack.body.deviceId}`))?.value ?? 0,
      );
      if (last >= ack.body.sequence!) {
        await serialized(async () => {
          const current = await watchSelection();
          if (current?.controlId !== request.controlId)
            throw new Error('Watch control changed. Retry.');
          await db.meta.put({
            key: WATCH_SELECTED_KEY,
            value: {
              ...current,
              owner: 'phone',
              offline: false,
              restTransfer:
                ack.body.restRemainingMs && ack.body.restRemainingMs > 0
                  ? { id: ack.id, seconds: Math.ceil(ack.body.restRemainingMs / 1000) }
                  : undefined,
            },
          });
        });
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new WatchUnavailableError(
    'The watch has not confirmed that all saved sets reached the phone. Open Ironpath on the watch and retry.',
  );
}

/** Explicit offline override never claims an exclusive lock or discards later arrivals. */
export async function allowOfflinePhoneControl(sessionId: string): Promise<void> {
  await serialized(async () => {
    const selected = await watchSelection();
    if (selected?.sessionId === sessionId)
      await db.meta.put({
        key: WATCH_SELECTED_KEY,
        value: { ...selected, owner: 'phone', offline: true },
      });
  });
}

export async function prepareWatchFinish(sessionId: string): Promise<void> {
  await takePhoneControl(sessionId);
  if ((await watchRecoveryActions(sessionId)).length)
    throw new Error(
      'Review the saved watch actions in Galaxy Watch before completing this workout.',
    );
}

/** The old wrist alert is already cancelled; resuming the paused remainder is explicit. */
export async function consumeTransferredRest(
  sessionId: string,
  transferId: string,
): Promise<number> {
  return serialized(async () => {
    const selected = await watchSelection();
    if (
      selected?.sessionId !== sessionId ||
      selected.owner !== 'phone' ||
      selected.restTransfer?.id !== transferId
    )
      throw new Error('That paused rest is no longer available.');
    const seconds = selected.restTransfer.seconds;
    await db.meta.put({ key: WATCH_SELECTED_KEY, value: { ...selected, restTransfer: undefined } });
    return seconds;
  });
}
