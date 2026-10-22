import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { makePlan, makeSettings } from '@/test/factories';
import { completeSession, createSession, getSession, saveSession } from '@/db/repository';
import type { WorkoutSession } from '@/types';
import type { WatchCompat } from '@/utils/watchLink';
import {
  beginFinish,
  cancelFinish,
  completeFinish,
  allowOfflinePhoneControl,
  reconcileWatchInbox,
  releaseStaleFreeze,
  sendWorkoutToWatch,
  watchSelection,
  watchSyncStatus,
  WatchReviewRequiredError,
  WatchUnavailableError,
} from './transport';
import { packet } from './protocol';
import type { ControlV2, WatchMutationV2, WatchSnapshotV2, WorkPacket } from './protocol';

const native = vi.hoisted(() => ({
  inspectWorkout: vi.fn(),
  completeWorkoutCommand: vi.fn(),
  flushWorkout: vi.fn(),
  publishWorkout: vi.fn(),
  controlWorkout: vi.fn(),
  compat: vi.fn(),
}));
const rest = vi.hoisted(() => ({ closeCoordinatedRest: vi.fn() }));
vi.mock('@/utils/watchLink', async (original) => ({
  ...(await original<typeof import('@/utils/watchLink')>()),
  watchLinkSupported: () => true,
  watchCompat: () => native.compat().catch(() => null),
  WatchLink: native,
}));
vi.mock('./restCoordinator', () => rest);

const deviceId = '00000000-0000-4000-8000-0000000000d1';
const shared: WatchCompat = {
  phoneProtocols: [1, 2],
  peer: {
    nodeId: 'node',
    name: 'Galaxy Watch',
    reachable: true,
    protocols: [1, 2],
    versionName: '0.5.0',
    versionCode: 5,
    helloAt: 1,
  },
  sharedMode: true,
  reason: 'ok',
};

interface NativeState {
  inbox: { peer: string; packet: WorkPacket }[];
  controlConfirmation: unknown;
  confirmation: unknown;
  published: WorkPacket | null;
  compat: WatchCompat | null;
  watchStatus: unknown;
}
let state: NativeState;
let controls: WorkPacket[];
let published: WorkPacket[];
let results: WorkPacket[];
/** Simulates the watch answering a freeze with its sequence checkpoint. */
let onControl: ((message: WorkPacket) => void) | undefined;

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  vi.resetAllMocks();
  await Promise.all([db.sessions.clear(), db.plans.clear(), db.settings.clear(), db.meta.clear()]);
  state = {
    inbox: [],
    controlConfirmation: null,
    confirmation: null,
    published: null,
    compat: shared,
    watchStatus: null,
  };
  controls = [];
  published = [];
  results = [];
  onControl = undefined;
  native.flushWorkout.mockResolvedValue(undefined);
  native.compat.mockImplementation(async () => {
    if (!state.compat) throw new Error('not implemented');
    return state.compat;
  });
  native.inspectWorkout.mockImplementation(async () => ({
    ...state,
    inbox: [...state.inbox],
    compat: state.compat ?? undefined,
  }));
  native.completeWorkoutCommand.mockImplementation(async ({ packet: message }) => {
    results.push(message);
    state.inbox = state.inbox.filter((row) => row.packet.id !== message.id);
  });
  native.publishWorkout.mockImplementation(async ({ packet: message }) => {
    published.push(message);
    state.published = message;
  });
  native.controlWorkout.mockImplementation(async ({ packet: message }) => {
    controls.push(message);
    onControl?.(message);
  });
  rest.closeCoordinatedRest.mockResolvedValue(undefined);
});

async function startSession(): Promise<WorkoutSession> {
  const plan = makePlan();
  const day = {
    ...plan.weeks[0]!.days[0]!,
    prescriptions: plan.weeks[0]!.days[0]!.prescriptions.filter((p) => p.entryStyle === 'reps'),
  };
  await db.plans.put({ ...plan, weeks: [{ ...plan.weeks[0]!, days: [day] }] });
  await db.settings.put(makeSettings());
  const session = await createSession(plan, day);
  return (await saveSession({ ...session, warmUpCompletedAt: new Date().toISOString() }))!;
}

/** Sends and confirms a shared snapshot. */
async function sharedSession() {
  const session = await startSession();
  const id = await sendWorkoutToWatch(session.id);
  state.confirmation = { id, body: { state: 'received', reason: '' } };
  await reconcileWatchInbox();
  return { session, snapshot: published.at(-1)!.body as WatchSnapshotV2 };
}

function mutationFor(
  snapshot: WatchSnapshotV2,
  sequence: number,
  patch: Partial<WatchMutationV2> = {},
): WorkPacket {
  const step = snapshot.steps.find((s) => s.supported)!;
  const opId = crypto.randomUUID();
  const body: WatchMutationV2 = {
    protocolVersion: 2,
    opId,
    epoch: snapshot.epoch,
    sessionId: snapshot.sessionId,
    deviceId,
    sequence,
    baseRevision: snapshot.revision,
    controlRevision: snapshot.controlRevision,
    op: 'complete',
    target: { prescriptionId: step.prescriptionId, exerciseId: step.exerciseId, setId: step.setId },
    expected: { completed: false, reps: null },
    changes: { completed: true, reps: 8 },
    undoOf: null,
    resolves: null,
    keep: null,
    createdAtWall: 1,
    ...patch,
  };
  return packet('mutation', body, opId, 2);
}

/** The watch freezes and reports `sequence` as its checkpoint, delivering `pending` first. */
function watchFreezesWith(sequence: number, pending: WorkPacket[] = []) {
  onControl = (message) => {
    const body = message.body as ControlV2;
    if (body.action !== 'freeze') return;
    state.inbox.push(...pending.map((row) => ({ peer: 'watch', packet: row })));
    state.controlConfirmation = {
      id: message.id,
      body: {
        state: 'received',
        reason: '',
        code: 'ok',
        deviceId,
        sequence,
        freezeId: body.freezeId,
      },
    };
  };
}

describe('compat gating and mixed versions', () => {
  it('publishes a v2 shared snapshot only when the watch negotiated v2', async () => {
    const session = await startSession();
    await sendWorkoutToWatch(session.id);
    expect(published.at(-1)).toMatchObject({ version: 2, type: 'snapshot' });
    expect(await watchSelection()).toMatchObject({ mode: 'shared', sessionId: session.id });
  });
  it('falls back to the v1 handoff for a 0.4 watch or an older native bridge', async () => {
    const session = await startSession();
    state.compat = { ...shared, sharedMode: false, reason: 'watchUpdateRequired' };
    await sendWorkoutToWatch(session.id);
    expect(published.at(-1)).toMatchObject({ version: 1, type: 'snapshot' });
    expect(await watchSelection()).toMatchObject({ owner: 'watch' });
    expect((await watchSelection())!.mode).toBeUndefined();
    state.compat = null;
    await db.meta.delete('watch:selected');
    await sendWorkoutToWatch(session.id);
    expect(published.at(-1)!.version).toBe(1);
  });
  it.each([
    [shared, 'shared'],
    [{ ...shared, sharedMode: false, reason: 'watchUpdateRequired' }, 'updateRequired'],
    [{ ...shared, peer: { ...shared.peer!, reachable: false } }, 'offline'],
    [{ ...shared, peer: null, sharedMode: false, reason: 'noWatch' }, 'off'],
    [{ ...shared, sharedMode: false, reason: 'helloPending' }, 'legacy'],
    [null, 'legacy'],
  ] as const)('reports the link state %#', async (compat, link) => {
    state.compat = compat as WatchCompat | null;
    expect((await watchSyncStatus()).link).toBe(link);
  });
  it('orders sync status: review, then waiting for phone, then saved on watch', async () => {
    const { session, snapshot } = await sharedSession();
    state.watchStatus = { pendingMutations: 2, pendingRestOps: 1, measuredAtWall: 5 };
    expect(await watchSyncStatus(session.id)).toMatchObject({
      sync: 'savedOnWatch',
      pendingOnWatch: 3,
      lastWatchStatusAt: 5,
    });
    state.inbox = [{ peer: 'watch', packet: mutationFor(snapshot, 1) }];
    expect((await watchSyncStatus(session.id)).sync).toBe('waitingForPhone');
    await saveSession({
      ...(await getSession(session.id))!,
      results: (await getSession(session.id))!.results.map((r, i) =>
        i === 0 ? { ...r, sets: r.sets.map((s, j) => (j === 0 ? { ...s, reps: 5 } : s)) } : r,
      ),
    });
    state.inbox = [
      {
        peer: 'watch',
        packet: mutationFor(snapshot, 1, {
          op: 'edit',
          expected: { reps: null },
          changes: { reps: 9 },
        }),
      },
    ];
    await reconcileWatchInbox();
    expect(await watchSyncStatus(session.id)).toMatchObject({ sync: 'needsReview', reviews: 1 });
  });
});

describe('shared reconcile', () => {
  it('imports v2 mutations, answers with v2 results and refreshes the snapshot once', async () => {
    const { session, snapshot } = await sharedSession();
    const count = published.length;
    state.inbox = [{ peer: 'watch', packet: mutationFor(snapshot, 1) }];
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_000);
    await reconcileWatchInbox();
    expect(results[0]).toMatchObject({ version: 2, type: 'result', body: { state: 'committed' } });
    expect(published).toHaveLength(count + 1);
    const refreshed = published.at(-1)!.body as WatchSnapshotV2;
    expect(refreshed.revision).toBe((await getSession(session.id))!.syncRevision);
    expect(refreshed.sequences[deviceId]).toBe(1);
    await reconcileWatchInbox();
    expect(published).toHaveLength(count + 1);
  });
  it('republishes a phone edit committed while the previous snapshot was being published', async () => {
    const { session } = await sharedSession();
    const editNotes = async (notes: string) =>
      saveSession({ ...(await getSession(session.id))!, sessionNotes: notes });
    await editNotes('first');
    // The next publish races a second phone commit.
    native.publishWorkout.mockImplementationOnce(async ({ packet: message }) => {
      published.push(message);
      await editNotes('second');
    });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 5_000);
    await reconcileWatchInbox();
    const racing = published.at(-1)!.body as WatchSnapshotV2;
    expect(racing.revision).toBeLessThan((await getSession(session.id))!.syncRevision!);
    clock.mockReturnValue(now + 10_000);
    await reconcileWatchInbox();
    clock.mockRestore();
    expect((published.at(-1)!.body as WatchSnapshotV2).revision).toBe(
      (await getSession(session.id))!.syncRevision,
    );
  });
  it('upgrades a v1 handoff to shared mode when a v2 hello arrives', async () => {
    const session = await startSession();
    state.compat = { ...shared, sharedMode: false, reason: 'helloPending' };
    await sendWorkoutToWatch(session.id);
    const v1 = published.at(-1)!.body as { controlRevision: number };
    state.compat = shared;
    await reconcileWatchInbox();
    const upgrade = published.at(-1)!;
    expect(upgrade.version).toBe(2);
    expect((upgrade.body as WatchSnapshotV2).controlRevision).toBeGreaterThan(v1.controlRevision);
    expect(await watchSelection()).toMatchObject({ mode: 'shared', sessionId: session.id });
  });
});

describe('finish barrier', () => {
  it('freezes, imports through the watch checkpoint, then queues closed once', async () => {
    const { session, snapshot } = await sharedSession();
    watchFreezesWith(1, [mutationFor(snapshot, 1)]);
    const { freezeId } = await beginFinish(session.id);
    const freeze = controls.at(-1)!;
    expect(freeze).toMatchObject({
      version: 2,
      body: { action: 'freeze', reason: 'finish', freezeId },
    });
    expect(
      (await getSession(session.id))!.results.flatMap((r) => r.sets).some((s) => s.reps === 8),
    ).toBe(true);
    expect((await watchSelection())!.freeze).toMatchObject({ id: freezeId, phase: 'frozen' });
    await completeSession((await getSession(session.id))!);
    await completeFinish(session.id);
    expect(controls.at(-1)).toMatchObject({
      version: 2,
      body: { action: 'closed', reason: 'completed', freezeId: null, sessionId: session.id },
    });
    expect(rest.closeCoordinatedRest).toHaveBeenCalledWith(session.id, 'finish');
    // Reconcile sees the completed published session but does not close it twice.
    const closes = controls.length;
    await reconcileWatchInbox();
    expect(controls).toHaveLength(closes);
  });
  it('holds finishing for reviews and restores shared editing on cancel', async () => {
    const { session, snapshot } = await sharedSession();
    await saveSession({
      ...(await getSession(session.id))!,
      results: (await getSession(session.id))!.results.map((r, i) =>
        i === 0 ? { ...r, sets: r.sets.map((s, j) => (j === 0 ? { ...s, reps: 5 } : s)) } : r,
      ),
    });
    watchFreezesWith(1, [
      mutationFor(snapshot, 1, { op: 'edit', expected: { reps: null }, changes: { reps: 9 } }),
    ]);
    const error = await beginFinish(session.id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WatchReviewRequiredError);
    const freezeId = (error as WatchReviewRequiredError).freezeId;
    expect(freezeId).toBeTruthy();
    await cancelFinish(session.id, freezeId);
    expect(controls.at(-1)).toMatchObject({ body: { action: 'unfreeze', freezeId } });
    expect((await watchSelection())!.freeze).toBeNull();
    // A stale cancel sends nothing.
    await cancelFinish(session.id, freezeId);
    expect(controls.filter((c) => (c.body as ControlV2).action === 'unfreeze')).toHaveLength(1);
  });
  it('refuses to finish before an acknowledged command is imported, then reuses the freeze', async () => {
    const { session, snapshot } = await sharedSession();
    watchFreezesWith(1);
    await expect(beginFinish(session.id)).rejects.toBeInstanceOf(WatchUnavailableError);
    expect((await getSession(session.id))!.status).toBe('inProgress');
    expect((await watchSelection())!.freeze).toMatchObject({ phase: 'freezing' });
    // The delayed command arrives on the next attempt; no second freeze is sent.
    state.inbox = [{ peer: 'watch', packet: mutationFor(snapshot, 1) }];
    const freezes = controls.length;
    await beginFinish(session.id);
    expect(controls).toHaveLength(freezes);
    expect((await watchSelection())!.freeze).toMatchObject({ phase: 'frozen' });
  }, 15_000);
  it('keeps the freeze queued for an explicit offline finish and refuses later arrivals', async () => {
    const { session, snapshot } = await sharedSession();
    await expect(beginFinish(session.id)).rejects.toBeInstanceOf(WatchUnavailableError);
    await allowOfflinePhoneControl(session.id);
    expect(await watchSelection()).toMatchObject({ offline: true, freeze: { phase: 'freezing' } });
    await completeSession((await getSession(session.id))!);
    await completeFinish(session.id);
    expect(controls.map((c) => (c.body as ControlV2).action)).toEqual(['freeze', 'closed']);
    // A delayed watch mutation cannot revive the completed workout.
    state.inbox = [{ peer: 'watch', packet: mutationFor(snapshot, 1) }];
    await reconcileWatchInbox();
    expect(results.at(-1)!.body).toMatchObject({
      state: 'rejected',
      code: 'sessionClosed',
      review: true,
    });
    expect((await getSession(session.id))!.status).toBe('completed');
    expect(
      (await getSession(session.id))!.results.flatMap((r) => r.sets).some((s) => s.completed),
    ).toBe(false);
  }, 15_000);
});

describe('workout switching', () => {
  it('drains the previous workout, closes its rest and selects the new one', async () => {
    const { session: first, snapshot } = await sharedSession();
    const second = await createSession(
      (await db.plans.toArray())[0]!,
      (await db.plans.toArray())[0]!.weeks[0]!.days[0]!,
    );
    await saveSession({ ...second, warmUpCompletedAt: new Date().toISOString() });
    watchFreezesWith(1, [mutationFor(snapshot, 1)]);
    await sendWorkoutToWatch(second.id);
    expect(controls[0]).toMatchObject({
      body: { action: 'freeze', reason: 'switch', sessionId: first.id },
    });
    // A switch only cancels the rest; the previous workout stays open for rests.
    expect(rest.closeCoordinatedRest).toHaveBeenCalledWith(first.id, 'switch');
    expect(rest.closeCoordinatedRest).not.toHaveBeenCalledWith(first.id, 'finish');
    const next = published.at(-1)!.body as WatchSnapshotV2;
    expect(next.sessionId).toBe(second.id);
    expect(next.controlRevision).toBeGreaterThan((controls[0]!.body as ControlV2).controlRevision);
    expect(next.sequences[deviceId]).toBe(1);
    expect(await watchSelection()).toMatchObject({
      sessionId: second.id,
      mode: 'shared',
      freeze: null,
    });
    // The watch still holds unimported work: it refuses with `pending`, and reconcile retries.
    const selected = (await watchSelection())!;
    state.confirmation = {
      id: selected.snapshotId,
      body: { state: 'rejected', reason: '', code: 'pending' },
    };
    const count = published.length;
    await reconcileWatchInbox();
    expect(published).toHaveLength(count + 1);
    expect((await watchSelection())!.snapshotId).toBe(published.at(-1)!.id);
  });
});

describe('stale freeze release', () => {
  async function frozen(reason: 'finish' | 'switch', patch: Record<string, unknown> = {}) {
    const { session } = await sharedSession();
    const selected = (await watchSelection())!;
    const freeze = {
      id: crypto.randomUUID(),
      reason,
      controlId: crypto.randomUUID(),
      phase: 'freezing',
      since: Date.now() - 60_000,
    };
    await db.meta.put({ key: 'watch:selected', value: { ...selected, freeze, ...patch } });
    controls.length = 0;
    return { session, freeze };
  }
  const unfreezes = () => controls.filter((c) => (c.body as ControlV2).action === 'unfreeze');

  it('releases a switch freeze left by a crash, whichever workout opens', async () => {
    const { freeze } = await frozen('switch');
    await releaseStaleFreeze('another_session');
    expect(unfreezes()).toMatchObject([{ body: { freezeId: freeze.id, reason: 'switch' } }]);
    expect((await watchSelection())!.freeze).toBeNull();
  });
  it('keeps a switch freeze younger than the barrier timeout', async () => {
    const { session, freeze } = await frozen('switch');
    await db.meta.put({
      key: 'watch:selected',
      value: { ...(await watchSelection())!, freeze: { ...freeze, since: Date.now() } },
    });
    await releaseStaleFreeze(session.id);
    expect(unfreezes()).toEqual([]);
  });
  it('releases a finish freeze only for the opened, non-offline, idle workout', async () => {
    const { session, freeze } = await frozen('finish');
    await releaseStaleFreeze('another_session');
    await releaseStaleFreeze(session.id, true);
    expect(unfreezes()).toEqual([]);
    await releaseStaleFreeze(session.id);
    expect(unfreezes()).toMatchObject([{ body: { freezeId: freeze.id } }]);
  });
  it('keeps the freeze of an explicit offline finish queued', async () => {
    const { session } = await frozen('finish', { offline: true });
    await releaseStaleFreeze(session.id);
    expect(unfreezes()).toEqual([]);
  });
});

describe('rest closing reasons', () => {
  it('closes the rest of a workout removed on another screen as removed', async () => {
    const { session } = await sharedSession();
    await db.sessions.delete(session.id);
    await reconcileWatchInbox();
    expect(controls.at(-1)).toMatchObject({ body: { action: 'closed', reason: 'removed' } });
    expect(rest.closeCoordinatedRest).toHaveBeenCalledWith(session.id, 'removed');
  });
});
