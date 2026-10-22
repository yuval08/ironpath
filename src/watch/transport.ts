import { version as appVersion } from '../../package.json';
import { db } from '@/db/db';
import { WatchLink, watchCompat, watchLinkSupported } from '@/utils/watchLink';
import type { WatchCompat, WatchWorkReport } from '@/utils/watchLink';
import {
  applyWatchCommand,
  applyWatchMutation,
  createWatchSnapshot,
  createWatchSnapshotV2,
  WATCH_SELECTED_KEY,
  WATCH_EPOCH_KEY,
  WATCH_CONTROL_KEY,
} from './sessionSync';
import { packet } from './protocol';
import type { ControlV2, WatchSnapshot, WatchSnapshotV2 } from './protocol';
import { watchRecoveryActions } from './recovery';
import { openReviews } from './reviews';
import { closeCoordinatedRest } from './restCoordinator';

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
  /** v2 shared logging; absent on v1 handoffs (legacy ownership). */
  mode?: 'legacy' | 'shared';
  /** Revision, open reviews and freeze of the last shared snapshot. */
  digest?: string;
  freeze?: {
    id: string;
    reason: 'finish' | 'switch';
    controlId: string;
    phase: 'freezing' | 'frozen';
    /** Phone wall ms when the freeze was sent; absent on early 1.0.6 builds. */
    since?: number;
  } | null;
}

export class WatchUnavailableError extends Error {}
export class WatchReviewRequiredError extends Error {
  constructor(
    message: string,
    readonly freezeId = '',
  ) {
    super(message);
  }
}

const REVIEW_BEFORE_FINISH =
  'Review the saved watch actions in Galaxy Watch before completing this workout.';

/** A shared-mode selection that is still live (optionally for one session). */
export function isSharedSelection(
  selected: WatchSelection | undefined,
  sessionId?: string,
): boolean {
  return (
    selected?.mode === 'shared' &&
    selected.owner !== 'closed' &&
    (!sessionId || selected.sessionId === sessionId)
  );
}

/** A v1 handoff where the watch still owns logging, so phone edits are locked. */
export function legacyWatchOwns(
  selected: WatchSelection | undefined,
  sessionId: string | undefined,
): boolean {
  return (
    !!selected &&
    !!sessionId &&
    selected.sessionId === sessionId &&
    selected.mode !== 'shared' &&
    (!selected.owner || selected.owner === 'watch' || selected.owner === 'pausing')
  );
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

async function sendControlV2(
  epoch: string,
  sessionId: string,
  action: ControlV2['action'],
  freezeId: string | null,
  reason: ControlV2['reason'],
): Promise<string> {
  const controlRevision = await nextControlRevision();
  const body: ControlV2 = { epoch, sessionId, controlRevision, action, freezeId, reason };
  const message = packet('control', body, crypto.randomUUID(), 2);
  await WatchLink.controlWorkout({ packet: message });
  return message.id;
}

let phoneInfo: Promise<WatchSnapshotV2['phone']> | undefined;
/** Native build number when available; the package version otherwise. */
function phoneVersion(): Promise<WatchSnapshotV2['phone']> {
  phoneInfo ??= (async () => {
    try {
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      const code = Number(info.build);
      return {
        versionName: info.version.slice(0, 20),
        versionCode: Number.isSafeInteger(code) && code > 0 ? code : 1,
      };
    } catch {
      return { versionName: appVersion.slice(0, 20), versionCode: 1 };
    }
  })();
  return phoneInfo;
}

const digestOf = (revision: number, reviewIds: string[], freezeId: string | null | undefined) =>
  `${revision}|${reviewIds.join(',')}|${freezeId ?? ''}`;

/** What the next snapshot would carry; compared with what the last one did carry. */
async function sharedDigest(sessionId: string, freezeId: string | null | undefined) {
  const session = await db.sessions.get(sessionId);
  // Snapshots carry at most 50 reviews, oldest first.
  const reviews = (await openReviews(sessionId)).slice(0, 50).map((review) => review.id);
  return digestOf(session?.syncRevision ?? 0, reviews, freezeId);
}

const lastSharedPublish = new Map<string, number>();
async function publishShared(
  sessionId: string,
  freeze: WatchSelection['freeze'],
): Promise<{ id: string; snapshot: WatchSnapshotV2; digest: string }> {
  const snapshot = await createWatchSnapshotV2(sessionId, {
    freeze: freeze ? { id: freeze.id, reason: freeze.reason } : null,
    phone: await phoneVersion(),
  });
  const message = packet('snapshot', snapshot, crypto.randomUUID(), 2);
  await WatchLink.publishWorkout({ packet: message });
  lastSharedPublish.set(sessionId, Date.now());
  // From the snapshot itself: an edit committed while publishing still differs and republishes.
  const digest = digestOf(
    snapshot.revision,
    snapshot.reviews.map((review) => review.id),
    snapshot.freeze?.id,
  );
  return { id: message.id, snapshot, digest };
}

/** Starts or replaces the shared selection with a fresh, higher-control snapshot. */
async function selectShared(sessionId: string): Promise<string> {
  await nextControlRevision();
  const published = await publishShared(sessionId, null);
  await db.meta.put({
    key: WATCH_SELECTED_KEY,
    value: {
      sessionId,
      epoch: published.snapshot.epoch,
      snapshotId: published.id,
      revision: published.snapshot.revision,
      confirmed: false,
      offline: false,
      mode: 'shared',
      digest: published.digest,
      freeze: null,
    } satisfies WatchSelection,
  });
  return published.id;
}

/** v1 commands and v2 mutations share one per-device sequence; import them in order. */
function sequenceOrder(
  a: WatchWorkReport['inbox'][number],
  b: WatchWorkReport['inbox'][number],
): number {
  const key = (row: WatchWorkReport['inbox'][number]) => {
    const body = row.packet.body as { deviceId?: unknown; sequence?: unknown } | null;
    return typeof body?.deviceId === 'string' && Number.isSafeInteger(body.sequence)
      ? { deviceId: body.deviceId, sequence: body.sequence as number }
      : null;
  };
  const x = key(a);
  const y = key(b);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return x.deviceId.localeCompare(y.deviceId) || x.sequence - y.sequence;
}

/** Native inbox receipt is separate from this canonical IndexedDB commit. */
export function reconcileWatchInbox(): Promise<void> {
  if (!watchLinkSupported()) return Promise.resolve();
  if (draining) return draining;
  draining = serialized(async () => {
    const report = await WatchLink.inspectWorkout();
    for (const row of [...report.inbox].sort(sequenceOrder)) {
      if (row.packet.version === 2 && row.packet.type === 'mutation') {
        const result = await applyWatchMutation(row.packet.id, row.packet.body);
        if (result.state === 'deferred') continue;
        await WatchLink.completeWorkoutCommand({
          peer: row.peer,
          packet: packet('result', result, row.packet.id, 2),
        });
        continue;
      }
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
        const alreadyClosed =
          selected?.owner === 'closed' &&
          selected.sessionId === body.sessionId &&
          selected.epoch === body.epoch;
        const reason =
          body.epoch !== epoch
            ? 'restored'
            : session?.status === 'completed'
              ? 'completed'
              : 'removed';
        if (alreadyClosed) {
          /* completeFinish queued the closure already. */
        } else if (published.version === 2) {
          await sendControlV2(body.epoch, body.sessionId, 'closed', null, reason);
          // Finished in another tab, deleted or restored: its rest can never resume.
          await closeCoordinatedRest(body.sessionId, reason === 'completed' ? 'finish' : reason);
        } else await sendControl(body.epoch, body.sessionId, 'closed');
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
    if (selected && isSharedSelection(selected) && selected.epoch === epoch)
      await refreshShared(selected, report);
    else if (
      report.compat?.sharedMode &&
      selected &&
      selected.epoch === epoch &&
      (!selected.owner || selected.owner === 'watch')
    ) {
      // A v2 hello arrived while the watch held a v1 handoff: upgrade the same session.
      const session = await db.sessions.get(selected.sessionId);
      if (session?.status === 'inProgress')
        await selectShared(selected.sessionId).catch((error: unknown) =>
          console.warn('[watch] shared upgrade waits for reconnect', error),
        );
    } else if (
      selected &&
      selected.epoch === epoch &&
      (!selected.owner || selected.owner === 'watch')
    ) {
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
  if ((await watchCompat())?.sharedMode) {
    const selected = await watchSelection();
    if (selected && isSharedSelection(selected) && selected.sessionId !== sessionId)
      return switchWatchWorkout(sessionId);
    return serialized(() => selectShared(sessionId));
  }
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
        value: isSharedSelection(selected)
          ? { ...selected, offline: true }
          : { ...selected, owner: 'phone', offline: true },
      });
  });
}

export async function prepareWatchFinish(sessionId: string): Promise<void> {
  await takePhoneControl(sessionId);
  if ((await watchRecoveryActions(sessionId)).length)
    throw new WatchReviewRequiredError(REVIEW_BEFORE_FINISH);
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

/* ------------------------------------------------------------------ */
/* v2 shared mode (design §1.3, §4)                                    */
/* ------------------------------------------------------------------ */

/** Runs inside reconcile: confirmation, switch retries and change-driven refreshes. */
async function refreshShared(selected: WatchSelection, report: WatchWorkReport): Promise<void> {
  const confirmation = report.confirmation;
  let current = selected;
  if (confirmation?.id === current.snapshotId) {
    if (confirmation.body.state === 'received' && !current.confirmed) {
      current = { ...current, confirmed: true };
      await db.meta.put({ key: WATCH_SELECTED_KEY, value: current });
    } else if (confirmation.body.state === 'rejected' && confirmation.body.code === 'pending') {
      // The watch still holds unimported work from the previous session; retry.
      try {
        const published = await publishShared(current.sessionId, current.freeze);
        await db.meta.put({
          key: WATCH_SELECTED_KEY,
          value: { ...current, snapshotId: published.id, digest: published.digest },
        });
      } catch (error) {
        console.warn('[watch] switch retry waits for reconnect', error);
      }
      return;
    }
  }
  const session = await db.sessions.get(current.sessionId);
  if (!current.confirmed || session?.status !== 'inProgress') return;
  if ((await sharedDigest(current.sessionId, current.freeze?.id)) === current.digest) return;
  // Snapshots replace each other in the outbox; still publish at most once per second.
  if (Date.now() - (lastSharedPublish.get(current.sessionId) ?? 0) < 1000) return;
  try {
    const published = await publishShared(current.sessionId, current.freeze);
    await db.meta.put({
      key: WATCH_SELECTED_KEY,
      value: { ...current, revision: published.snapshot.revision, digest: published.digest },
    });
  } catch (error) {
    console.warn('[watch] snapshot refresh waits for reconnect', error);
  }
}

const BARRIER_ATTEMPTS = 16;
const BARRIER_STEP_MS = 500;
/** Switches running in this JS context; their freeze is not stale. */
let switching = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const UNCONFIRMED =
  'The watch has not confirmed that all saved sets reached the phone. Open Ironpath on the watch and retry.';

/**
 * Freezes watch mutations, then imports through the sequence the watch reported when
 * it froze. Returns null when the session is not in shared mode.
 */
async function freezeAndDrain(
  sessionId: string,
  reason: 'finish' | 'switch',
): Promise<NonNullable<WatchSelection['freeze']> | null> {
  await reconcileWatchInbox();
  const request = await serialized(async () => {
    const selected = await watchSelection();
    if (!selected || !isSharedSelection(selected, sessionId)) return null;
    if (selected.epoch !== (await watchEpochValue())) return null;
    if (selected.freeze?.reason === reason) return selected.freeze;
    const id = crypto.randomUUID();
    const controlId = await sendControlV2(selected.epoch, sessionId, 'freeze', id, reason);
    const freeze = { id, reason, controlId, phase: 'freezing' as const, since: Date.now() };
    await db.meta.put({ key: WATCH_SELECTED_KEY, value: { ...selected, freeze } });
    return freeze;
  });
  if (!request) return null;
  for (let i = 0; i < BARRIER_ATTEMPTS; i++) {
    await reconcileWatchInbox();
    const ack = (await WatchLink.inspectWorkout()).controlConfirmation;
    if (ack?.id === request.controlId && ack.body.state === 'rejected')
      throw new WatchUnavailableError(ack.body.reason || UNCONFIRMED);
    if (
      ack?.id === request.controlId &&
      ack.body.state === 'received' &&
      ack.body.deviceId &&
      Number.isSafeInteger(ack.body.sequence) &&
      (ack.body.freezeId == null || ack.body.freezeId === request.id)
    ) {
      const epoch = await watchEpochValue();
      const last = Number(
        (await db.meta.get(`watch:sequence:${epoch}:${ack.body.deviceId}`))?.value ?? 0,
      );
      if (last >= ack.body.sequence!) {
        const frozen = { ...request, phase: 'frozen' as const };
        await serialized(async () => {
          const current = await watchSelection();
          if (current?.freeze?.id !== request.id) throw new Error('Watch sync changed. Retry.');
          await db.meta.put({ key: WATCH_SELECTED_KEY, value: { ...current, freeze: frozen } });
        });
        return frozen;
      }
    }
    await sleep(BARRIER_STEP_MS);
  }
  throw new WatchUnavailableError(UNCONFIRMED);
}

/**
 * A freeze left by a closed or crashed screen keeps the watch frozen. On opening a
 * workout, release a finish freeze for it (unless finishing or explicitly offline)
 * and any switch freeze older than the barrier with no switch running.
 */
export async function releaseStaleFreeze(openSessionId: string, finishing = false): Promise<void> {
  const selected = await watchSelection();
  if (!selected || !isSharedSelection(selected) || !selected.freeze) return;
  const { freeze } = selected;
  const stale =
    freeze.reason === 'finish'
      ? selected.sessionId === openSessionId && !selected.offline && !finishing
      : switching === 0 && Date.now() - (freeze.since ?? 0) > BARRIER_ATTEMPTS * BARRIER_STEP_MS;
  if (stale) await cancelFinish(selected.sessionId, freeze.id);
}

async function watchEpochValue(): Promise<unknown> {
  return (await db.meta.get(WATCH_EPOCH_KEY))?.value;
}

/**
 * Finish barrier: freeze both screens, import through the watch checkpoint and refuse
 * while reviews are open. Legacy handoffs use the v1 pause unchanged.
 */
export async function beginFinish(
  sessionId: string,
): Promise<{ freezeId: string; checkpointImported: true }> {
  if (!watchLinkSupported() || !isSharedSelection(await watchSelection(), sessionId)) {
    await prepareWatchFinish(sessionId);
    return { freezeId: '', checkpointImported: true };
  }
  const freeze = await freezeAndDrain(sessionId, 'finish');
  if (!freeze) {
    await prepareWatchFinish(sessionId);
    return { freezeId: '', checkpointImported: true };
  }
  if ((await watchRecoveryActions(sessionId)).length)
    throw new WatchReviewRequiredError(REVIEW_BEFORE_FINISH, freeze.id);
  return { freezeId: freeze.id, checkpointImported: true };
}

/** Restores shared editing. An empty `freezeId` cancels whatever freeze is pending. */
export async function cancelFinish(sessionId: string, freezeId: string): Promise<void> {
  if (!watchLinkSupported()) return;
  await serialized(async () => {
    const selected = await watchSelection();
    if (
      !selected ||
      !isSharedSelection(selected, sessionId) ||
      !selected.freeze ||
      (freezeId && selected.freeze.id !== freezeId)
    )
      return;
    await sendControlV2(
      selected.epoch,
      sessionId,
      'unfreeze',
      selected.freeze.id,
      selected.freeze.reason,
    );
    await db.meta.put({
      key: WATCH_SELECTED_KEY,
      value: { ...selected, freeze: null, offline: false },
    });
  });
  await WatchLink.flushWorkout().catch(() => {});
}

/** After completeSession: queue `closed` for the watch and end the shared rest. */
export async function completeFinish(sessionId: string): Promise<void> {
  await closeCoordinatedRest(sessionId, 'finish');
  if (!watchLinkSupported()) return;
  await serialized(async () => {
    const selected = await watchSelection();
    if (!selected || !isSharedSelection(selected, sessionId)) return;
    await sendControlV2(selected.epoch, sessionId, 'closed', null, 'completed');
    await db.meta.put({
      key: WATCH_SELECTED_KEY,
      value: { ...selected, owner: 'closed', freeze: null },
    });
  });
  await WatchLink.flushWorkout().catch(() => {});
}

/**
 * Drains the previous shared workout, ends its rest and selects another one. Reviews
 * stay retained; a watch that still holds work refuses with `pending` and the next
 * reconcile republishes.
 */
export async function switchWatchWorkout(sessionId: string): Promise<string> {
  switching++;
  try {
    return await switchSelection(sessionId);
  } finally {
    switching--;
  }
}

async function switchSelection(sessionId: string): Promise<string> {
  const selected = await watchSelection();
  if (selected && isSharedSelection(selected) && selected.sessionId !== sessionId) {
    const previous = await db.sessions.get(selected.sessionId);
    if (previous?.status === 'inProgress') {
      await freezeAndDrain(selected.sessionId, 'switch').catch((error: unknown) => {
        if (!(error instanceof WatchUnavailableError)) throw error;
      });
    }
    // The previous workout stays in progress: cancel its rest without closing it.
    await closeCoordinatedRest(selected.sessionId, 'switch');
  }
  return serialized(() => selectShared(sessionId));
}

export interface PhoneWatchStatus {
  link: 'off' | 'legacy' | 'updateRequired' | 'offline' | 'shared';
  sync: 'synced' | 'savedOnWatch' | 'waitingForPhone' | 'needsReview';
  pendingOnWatch: number;
  inbox: number;
  reviews: number;
  peer: { versionName: string | null; protocols: number[] | null } | null;
  lastWatchStatusAt: number | null;
}

function linkState(compat: WatchCompat | null): PhoneWatchStatus['link'] {
  if (!compat) return 'legacy';
  if (compat.reason === 'noWatch' || compat.reason === 'multipleWatches' || !compat.peer)
    return 'off';
  if (!compat.peer.reachable) return 'offline';
  if (compat.reason === 'watchUpdateRequired') return 'updateRequired';
  return compat.sharedMode ? 'shared' : 'legacy';
}

/** What the phone knows about the watch, by priority (design §6.2 "Phone status"). */
export async function watchSyncStatus(sessionId?: string): Promise<PhoneWatchStatus> {
  const reviews = (await watchRecoveryActions(sessionId)).length;
  const supported = watchLinkSupported();
  const [compat, report] = supported
    ? await Promise.all([watchCompat(), WatchLink.inspectWorkout().catch(() => null)])
    : [null, null];
  const status = report?.watchStatus ?? null;
  const pendingOnWatch = status ? status.pendingMutations + status.pendingRestOps : 0;
  const inbox = report?.inbox.length ?? 0;
  return {
    link: supported ? linkState(compat) : 'off',
    sync: reviews
      ? 'needsReview'
      : inbox
        ? 'waitingForPhone'
        : pendingOnWatch
          ? 'savedOnWatch'
          : 'synced',
    pendingOnWatch,
    inbox,
    reviews,
    peer: compat?.peer
      ? { versionName: compat.peer.versionName, protocols: compat.peer.protocols }
      : null,
    lastWatchStatusAt: status?.measuredAtWall ?? null,
  };
}
