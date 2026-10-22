import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import {
  createSession,
  getSession,
  saveSession,
  saveSessionElapsed,
  completeSession,
} from '@/db/repository';
import { migrateRecord } from '@/db/migrations';
import { buildBackup, restoreBackup } from '@/utils/backup';
import { makePlan, makeSettings } from '@/test/factories';
import type { WorkoutSession } from '@/types';
import {
  applyWatchCommand,
  applyWatchMutation,
  createWatchSnapshot,
  createWatchSnapshotV2,
  executionSteps,
  setState,
  WATCH_EPOCH_KEY,
} from './sessionSync';
import {
  packet,
  watchCommandSchema,
  watchMutationV2Schema,
  watchResultV2Schema,
  watchSnapshotV2Schema,
} from './protocol';
import type {
  ResultCode,
  WatchCommand,
  WatchMutationV2,
  WatchResultV2,
  WatchStepV2,
} from './protocol';
import { openReviews } from './reviews';
import { resolveReview, watchRecoveryActions } from './recovery';

let session: WorkoutSession;
const plan = makePlan();
const day = {
  ...plan.weeks[0]!.days[0]!,
  prescriptions: plan.weeks[0]!.days[0]!.prescriptions.filter((p) => p.entryStyle === 'reps').slice(
    0,
    2,
  ),
};
const deviceId = '00000000-0000-4000-8000-000000000001';
let epoch: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([db.sessions.clear(), db.plans.clear(), db.settings.clear(), db.meta.clear()]);
  await db.plans.put({ ...plan, weeks: [{ ...plan.weeks[0]!, days: [day] }] });
  await db.settings.put(makeSettings());
  session = await createSession(plan, day);
  session = (await saveSession({ ...session, warmUpCompletedAt: new Date().toISOString() }))!;
  epoch = (await createWatchSnapshot(session.id)).epoch;
});

function command(sequence = 1): WatchCommand {
  const exercise = session.results[0]!;
  const set = exercise.sets[0]!;
  return {
    protocolVersion: 1,
    epoch,
    sessionId: session.id,
    deviceId,
    sequence,
    baseRevision: session.syncRevision ?? 0,
    action: 'set',
    prescriptionId: exercise.prescriptionId,
    exerciseId: exercise.exerciseId,
    setId: set.id!,
    expected: setState(set),
    changes: { completed: true, reps: 8 },
  };
}

describe('watch persistence and reconciliation', () => {
  it('migrates legacy sets deterministically and preserves IDs after reordering', () => {
    const legacy: WorkoutSession = {
      ...session,
      schemaVersion: 5,
      results: session.results.map((r) => ({
        ...r,
        sets: r.sets.map(({ id: _id, ...set }) => set),
      })),
    };
    const first = migrateRecord(legacy);
    expect(first.results[0]!.sets[0]!.id).toBe(migrateRecord(legacy).results[0]!.sets[0]!.id);
    const id = first.results[0]!.sets[0]!.id;
    first.results[0]!.sets.reverse();
    expect(migrateRecord(first).results[0]!.sets.some((set) => set.id === id)).toBe(true);
  });
  it('saves stable identity and never turns target reps into actual logged reps', async () => {
    const snapshot = await createWatchSnapshot(session.id);
    expect(snapshot.steps.length).toBeGreaterThan(0);
    expect(snapshot.steps[0]!.actual.reps).toBeNull();
    expect(snapshot.steps[0]!.target).not.toBe('');
    expect((await getSession(session.id))!.results[0]!.sets[0]!.id).toBe(snapshot.steps[0]!.setId);
    expect(new Set(snapshot.steps.map((s) => s.setId)).size).toBe(snapshot.steps.length);
  });
  it('commits an effect and replay ledger once under concurrent delivery', async () => {
    const id = crypto.randomUUID();
    const results = await Promise.all([
      applyWatchCommand(id, command()),
      applyWatchCommand(id, command()),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]!.state).toBe('committed');
    expect((await getSession(session.id))!.syncRevision).toBe((session.syncRevision ?? 0) + 1);
    expect((await getSession(session.id))!.results[0]!.sets[0]).toMatchObject({
      completed: true,
      reps: 8,
    });
  });
  it('imports undo as a second command and publishes the device sequence watermark', async () => {
    const first = command();
    await applyWatchCommand(crypto.randomUUID(), first);
    const completed = (await getSession(session.id))!.results[0]!.sets[0]!;
    const undo = { ...command(2), expected: setState(completed), changes: first.expected };
    expect((await applyWatchCommand(crypto.randomUUID(), undo)).state).toBe('committed');
    const snapshot = await createWatchSnapshot(session.id);
    expect(snapshot.steps[0]!.actual.completed).toBe(false);
    expect(snapshot.steps[0]!.actual.reps).toBeNull();
    expect(snapshot.sequences?.[deviceId]).toBe(2);
  });
  it('preserves explicit zero actuals and wrist vibration preferences', async () => {
    await db.settings.put(makeSettings({ vibrateOnRestEnd: false }));
    await applyWatchCommand(crypto.randomUUID(), {
      ...command(),
      changes: { completed: true, reps: 0, weight: 0 },
    });
    const snapshot = await createWatchSnapshot(session.id);
    expect(snapshot.steps[0]!.actual).toMatchObject({ reps: 0, weight: 0 });
    expect(snapshot.vibrate).toBe(false);
  });
  it('replays the cached result after the transport loses its acknowledgement', async () => {
    const id = crypto.randomUUID();
    const result = await applyWatchCommand(id, command());
    await saveSession({ ...(await getSession(session.id))!, sessionNotes: 'later phone edit' });
    expect(await applyWatchCommand(id, command())).toEqual(result);
  });
  it('refuses ID reuse with a different payload', async () => {
    const id = crypto.randomUUID();
    await applyWatchCommand(id, command());
    expect((await applyWatchCommand(id, { ...command(), changes: { reps: 99 } })).state).toBe(
      'rejected',
    );
    expect((await getSession(session.id))!.results[0]!.sets[0]!.reps).toBe(8);
  });
  it('defers gaps without consuming their IDs or sequence numbers', async () => {
    const id = crypto.randomUUID();
    const second = {
      ...command(2),
      setId: session.results[0]!.sets[1]!.id!,
      expected: setState(session.results[0]!.sets[1]!),
    };
    expect((await applyWatchCommand(id, second)).state).toBe('deferred');
    await applyWatchCommand(crypto.randomUUID(), command());
    expect((await applyWatchCommand(id, second)).state).toBe('committed');
  });
  it('allows unrelated phone changes but preserves them during set import', async () => {
    await saveSession({ ...session, sessionNotes: 'keep this' });
    expect((await applyWatchCommand(crypto.randomUUID(), command())).state).toBe('committed');
    expect((await getSession(session.id))!.sessionNotes).toBe('keep this');
  });
  it('reports same-set conflicts and does not overwrite the phone value', async () => {
    const changed = structuredClone(session);
    changed.results[0]!.sets[0]!.reps = 12;
    await saveSession(changed);
    expect((await applyWatchCommand(crypto.randomUUID(), command())).state).toBe('conflict');
    expect((await getSession(session.id))!.results[0]!.sets[0]!.reps).toBe(12);
  });
  it('rejects a stale whole-document phone save after a watch mutation', async () => {
    await applyWatchCommand(crypto.randomUUID(), command());
    await expect(saveSession({ ...session, sessionNotes: 'stale' })).rejects.toThrow('changed');
    expect((await getSession(session.id))!.results[0]!.sets[0]!.completed).toBe(true);
  });
  it('keeps elapsed writes independent of edits and never moves time backwards', async () => {
    await saveSessionElapsed(session.id, 30);
    await applyWatchCommand(crypto.randomUUID(), command());
    await saveSessionElapsed(session.id, 10);
    expect((await getSession(session.id))!.elapsedSeconds).toBe(30);
  });
  it('rolls back the set when ledger persistence fails', async () => {
    const put = db.meta.put.bind(db.meta);
    vi.spyOn(db.meta, 'put').mockImplementation(((row: { key: string; value: unknown }) => {
      if (row.key.startsWith('watch:command:')) throw new Error('Disk full');
      return put(row);
    }) as typeof db.meta.put);
    await expect(applyWatchCommand(crypto.randomUUID(), command())).rejects.toThrow('Disk full');
    expect((await getSession(session.id))!.results[0]!.sets[0]!.completed).toBe(false);
  });
  it('does not reopen closed/deleted sessions or advance their plans', async () => {
    await completeSession(session);
    expect((await applyWatchCommand(crypto.randomUUID(), command())).state).toBe('rejected');
    await db.sessions.delete(session.id);
    expect((await applyWatchCommand(crypto.randomUUID(), command(2))).state).toBe('rejected');
    expect(await getSession(session.id)).toBeUndefined();
  });
  it('rotates the epoch on backup restore and refuses pre-restore work', async () => {
    const backup = await buildBackup();
    await restoreBackup(backup);
    expect((await db.meta.get(WATCH_EPOCH_KEY))!.value).not.toBe(epoch);
    expect((await applyWatchCommand(crypto.randomUUID(), command())).state).toBe('rejected');
  });
  it('validates versions, unknown fields, non-finite metrics, and packet size', () => {
    expect(watchCommandSchema.safeParse({ ...command(), protocolVersion: 2 }).success).toBe(false);
    expect(watchCommandSchema.safeParse({ ...command(), changes: { reps: NaN } }).success).toBe(
      false,
    );
    expect(
      watchCommandSchema.safeParse({ ...command(), changes: { completed: true, hacked: true } })
        .success,
    ).toBe(false);
    expect(() => packet('snapshot', { oversized: 'x'.repeat(100_000) })).toThrow('large');
  });
  it('does not replay a pre-restore committed ACK as success in a restored timeline', async () => {
    const before = await buildBackup();
    const id = crypto.randomUUID();
    expect((await applyWatchCommand(id, command())).state).toBe('committed');
    await restoreBackup(before);
    expect((await applyWatchCommand(id, command())).state).toBe('rejected');
    expect((await getSession(session.id))!.results[0]!.sets[0]!.completed).toBe(false);
  });
  it('orders shared superset rounds before extra straight sets and excludes ramp rests', () => {
    const paired = structuredClone(day);
    const a = paired.prescriptions[0]!;
    const b = paired.prescriptions[1]!;
    Object.assign(a, { supersetKey: 'pair', blockLabel: 'Pair', sets: 2, restSeconds: 0 });
    Object.assign(b, { supersetKey: 'pair', blockLabel: 'Pair', sets: 3, restSeconds: 90 });
    const result = structuredClone(session);
    result.results[0]!.sets = Array.from({ length: 2 }, (_, i) => ({
      ...result.results[0]!.sets[0]!,
      id: `a${i}`,
      setNumber: i + 1,
    }));
    result.results[1]!.sets = Array.from({ length: 3 }, (_, i) => ({
      ...result.results[1]!.sets[0]!,
      id: `b${i}`,
      setNumber: i + 1,
    }));
    result.results[0]!.sets.unshift({ ...result.results[0]!.sets[0]!, id: 'ramp', isWarmUp: true });
    const steps = executionSteps(paired, result, 'kg');
    expect(steps.map((s) => s.setId)).toEqual(['ramp', 'a0', 'b0', 'a1', 'b1', 'b2']);
    expect(steps.map((s) => s.restAfter)).toEqual([0, 0, 90, 0, 90, 90]);
  });
});

const PHONE = { versionName: '1.0.6', versionCode: 7 };

function mutation(sequence: number, patch: Partial<WatchMutationV2> = {}): WatchMutationV2 {
  const exercise = session.results[0]!;
  const set = exercise.sets[0]!;
  return {
    protocolVersion: 2,
    opId: crypto.randomUUID(),
    epoch,
    sessionId: session.id,
    deviceId,
    sequence,
    baseRevision: session.syncRevision ?? 0,
    controlRevision: 1,
    op: 'complete',
    target: {
      prescriptionId: exercise.prescriptionId,
      exerciseId: exercise.exerciseId,
      setId: set.id!,
    },
    expected: { completed: false, reps: null },
    changes: { completed: true, reps: 8 },
    undoOf: null,
    resolves: null,
    keep: null,
    createdAtWall: Date.now(),
    ...patch,
  };
}
const apply = (m: WatchMutationV2) => applyWatchMutation(m.opId, m) as Promise<WatchResultV2>;
const firstSet = async () => (await getSession(session.id))!.results[0]!.sets[0]!;
const phoneEdit = async (mutate: (draft: WorkoutSession) => void) => {
  const draft = (await getSession(session.id))!;
  mutate(draft);
  await saveSession(draft);
};

describe('sync v2 snapshot', () => {
  it('adds slot, group, band label, reviews and freeze to the v1 step order', async () => {
    const paired = structuredClone(day);
    Object.assign(paired.prescriptions[0]!, { supersetKey: 'a', blockLabel: 'A', slot: 'A1' });
    Object.assign(paired.prescriptions[1]!, { supersetKey: 'a', blockLabel: 'A', slot: 'A2' });
    await db.plans.put({ ...plan, weeks: [{ ...plan.weeks[0]!, days: [paired] }] });
    await phoneEdit((draft) => void (draft.results[0]!.sets[0]!.band = 'light'));
    await phoneEdit((draft) => void (draft.results[0]!.sets[1]!.reps = 10));
    const late = mutation(1, {
      target: { ...mutation(1).target, setId: session.results[0]!.sets[1]!.id! },
      expected: { reps: null },
      changes: { reps: 12 },
      op: 'edit',
    });
    expect((await apply(late)).state).toBe('conflict');
    const freeze = { id: crypto.randomUUID(), reason: 'finish' as const };
    const snapshot = await createWatchSnapshotV2(session.id, { phone: PHONE, freeze });
    expect(watchSnapshotV2Schema.safeParse(snapshot).success).toBe(true);
    const v1 = await createWatchSnapshot(session.id);
    expect(snapshot.steps.map((s) => s.setId)).toEqual(v1.steps.map((s) => s.setId));
    expect(new Set(snapshot.steps.map((s) => s.group))).toEqual(new Set([0]));
    expect(snapshot.steps.map((s) => s.slot).slice(0, 2)).toEqual(['A1', 'A2']);
    expect(snapshot.steps.find((s) => s.setId === session.results[0]!.sets[0]!.id)!.bandLabel).toBe(
      'Light',
    );
    expect(snapshot.steps.filter((s) => s.review).map((s) => s.setId)).toEqual([
      session.results[0]!.sets[1]!.id,
    ]);
    expect(snapshot.reviews).toEqual([
      {
        id: late.opId,
        setId: late.target.setId,
        origin: 'watch',
        code: 'fieldConflict',
        reason: expect.any(String),
        fields: [{ field: 'reps', phone: 10, requested: 12, conflict: true }],
      },
    ]);
    expect(snapshot).toMatchObject({
      freeze,
      phone: PHONE,
      protocolVersion: 2,
      elapsedRunning: true,
    });
    expect(snapshot.sequences[deviceId]).toBe(1);
  });
  it('keeps a 400-step snapshot with maximum-length names inside the friendly size error', async () => {
    const snapshot = await createWatchSnapshotV2(session.id, { phone: PHONE });
    const step: WatchStepV2 = { ...snapshot.steps[0]!, name: 'N'.repeat(256) };
    const big = {
      ...snapshot,
      steps: Array.from({ length: 400 }, (_, i) => ({ ...step, setId: `set-${i}` })),
    };
    expect(watchSnapshotV2Schema.safeParse(big).success).toBe(true);
    let error: unknown;
    try {
      packet('snapshot', big, crypto.randomUUID(), 2);
    } catch (caught) {
      error = caught;
    }
    if (error)
      expect((error as Error).message).toBe('This workout is too large to send to the watch.');
  });
});

describe('sync v2 mutations (applyWatchMutation)', () => {
  it('merges different fields on the same set and returns a schema-valid result', async () => {
    await phoneEdit((draft) => void (draft.results[0]!.sets[0]!.weight = 62.5));
    const result = await apply(mutation(1));
    expect(watchResultV2Schema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ state: 'committed', code: 'ok', review: false });
    expect(await firstSet()).toMatchObject({ completed: true, reps: 8, weight: 62.5 });
    expect(result.revision).toBe((await getSession(session.id))!.syncRevision);
  });
  it('treats a duplicate completion with the same values as a no-op', async () => {
    await phoneEdit((draft) =>
      Object.assign(draft.results[0]!.sets[0]!, { completed: true, reps: 8 }),
    );
    const revision = (await getSession(session.id))!.syncRevision;
    const result = await apply(mutation(1));
    expect(result).toMatchObject({ state: 'committed', code: 'noop', revision });
    expect((await getSession(session.id))!.syncRevision).toBe(revision);
  });
  it('turns a duplicate completion with different reps into a set-scoped review', async () => {
    await phoneEdit((draft) =>
      Object.assign(draft.results[0]!.sets[0]!, { completed: true, reps: 8 }),
    );
    const m = mutation(1, { changes: { completed: true, reps: 10 } });
    const result = await apply(m);
    expect(result).toMatchObject({
      state: 'conflict',
      code: 'fieldConflict',
      review: true,
      // Every changed field is listed, so the held-back completion is not lost.
      fields: [
        { field: 'completed', phone: true, requested: true, conflict: false },
        { field: 'reps', phone: 8, requested: 10, conflict: true },
      ],
    });
    expect((await firstSet()).reps).toBe(8);
    expect(await openReviews(session.id)).toMatchObject([{ id: m.opId, origin: 'watch' }]);
    // The next independent set still imports.
    const other = mutation(2, {
      target: { ...m.target, setId: session.results[0]!.sets[1]!.id! },
    });
    expect((await apply(other)).state).toBe('committed');
  });
  const targetChanges: [ResultCode, 'conflict' | 'rejected', (d: WorkoutSession) => void][] = [
    [
      'exerciseChanged',
      'conflict',
      (d) => void (d.results[0]!.substitutionExerciseId = 'ring-row'),
    ],
    ['exerciseSkipped', 'rejected', (d) => void (d.results[0]!.skippedReason = 'pain')],
    ['setMissing', 'rejected', (d) => void d.results[0]!.sets.shift()],
  ];
  it.each(targetChanges)('refuses %s with a review', async (code, state, mutate) => {
    await phoneEdit(mutate);
    const result = await apply(mutation(1));
    expect(result).toMatchObject({ state, code, review: true });
    expect((await openReviews(session.id))[0]!.code).toBe(code);
  });
  it('refuses unsupported entry styles and closed workouts', async () => {
    const changed = structuredClone(day);
    changed.prescriptions[0]!.entryStyle = 'time';
    await db.plans.put({ ...plan, weeks: [{ ...plan.weeks[0]!, days: [changed] }] });
    expect(await apply(mutation(1))).toMatchObject({ code: 'unsupportedStyle', review: true });
    await completeSession((await getSession(session.id))!);
    expect(await apply(mutation(2))).toMatchObject({
      state: 'rejected',
      code: 'sessionClosed',
      review: true,
    });
  });
  it('reverts with undo, is a no-op after a phone revert, and conflicts after a later edit', async () => {
    const original = mutation(1);
    await apply(original);
    const undo = (sequence: number) =>
      mutation(sequence, {
        op: 'undo',
        undoOf: original.opId,
        expected: original.changes,
        changes: original.expected,
      });
    expect(await apply(undo(2))).toMatchObject({ state: 'committed', code: 'ok' });
    expect(await firstSet()).toMatchObject({ completed: false, reps: null });
    expect(await apply(undo(3))).toMatchObject({ state: 'committed', code: 'noop' });
    await apply(mutation(4));
    await phoneEdit((draft) => void (draft.results[0]!.sets[0]!.reps = 9));
    expect(await apply(undo(5))).toMatchObject({ state: 'conflict', code: 'fieldConflict' });
    expect(await firstSet()).toMatchObject({ completed: true, reps: 9 });
  });
  it('resolves a review once from either device, applying watch values conditionally', async () => {
    await phoneEdit((draft) => void (draft.results[0]!.sets[0]!.reps = 8));
    const conflicting = mutation(1, {
      op: 'edit',
      expected: { reps: null },
      changes: { reps: 10 },
    });
    await apply(conflicting);
    const resolve = (sequence: number, keep: 'phone' | 'watch') =>
      mutation(sequence, {
        op: 'resolve',
        resolves: conflicting.opId,
        keep,
        expected: keep === 'watch' ? { reps: 8 } : {},
        changes: keep === 'watch' ? { reps: 10 } : {},
      });
    expect(await apply(resolve(2, 'watch'))).toMatchObject({ state: 'committed', code: 'ok' });
    expect((await firstSet()).reps).toBe(10);
    expect(await openReviews(session.id)).toEqual([]);
    // The phone resolving the same review afterwards changes nothing.
    expect(await resolveReview(conflicting.opId, 'phone')).toBe('applied');
    expect(await apply(resolve(3, 'phone'))).toMatchObject({ state: 'committed', code: 'noop' });
    expect((await firstSet()).reps).toBe(10);
  });
  it('supersedes a watch resolve whose shown phone values are stale', async () => {
    await phoneEdit((draft) => void (draft.results[0]!.sets[0]!.reps = 8));
    const conflicting = mutation(1, {
      op: 'edit',
      expected: { reps: null },
      changes: { reps: 10 },
    });
    await apply(conflicting);
    await phoneEdit((draft) => void (draft.results[0]!.sets[0]!.reps = 9));
    const resolve = mutation(2, {
      op: 'resolve',
      resolves: conflicting.opId,
      keep: 'watch',
      expected: { reps: 8 },
      changes: { reps: 10 },
    });
    expect(await apply(resolve)).toMatchObject({ state: 'conflict', review: true });
    expect((await openReviews(session.id)).map((r) => r.id)).toEqual([resolve.opId]);
    expect((await firstSet()).reps).toBe(9);
  });
  it('interleaves v1 commands and v2 mutations in one device sequence', async () => {
    const v2 = mutation(2, {
      target: { ...mutation(1).target, setId: session.results[0]!.sets[1]!.id! },
    });
    expect((await applyWatchMutation(v2.opId, v2)).state).toBe('deferred');
    expect((await applyWatchCommand(crypto.randomUUID(), command(1))).state).toBe('committed');
    expect((await apply(v2)).state).toBe('committed');
    const reused = {
      ...command(2),
      setId: session.results[1]!.sets[0]!.id!,
      expected: setState(session.results[1]!.sets[0]!),
    };
    expect((await applyWatchCommand(crypto.randomUUID(), reused)).state).toBe('rejected');
    expect((await createWatchSnapshotV2(session.id, { phone: PHONE })).sequences[deviceId]).toBe(2);
  });
  it('replays the ledger, refuses reused IDs and keeps evidence across an epoch change', async () => {
    const m = mutation(1);
    const first = await apply(m);
    expect(await apply(m)).toEqual(first);
    expect(
      await applyWatchMutation(m.opId, { ...m, changes: { completed: true, reps: 9 } }),
    ).toMatchObject({
      state: 'rejected',
      code: 'idReused',
    });
    await db.meta.put({ key: WATCH_EPOCH_KEY, value: crypto.randomUUID() });
    const stale = mutation(2);
    expect(await apply(stale)).toMatchObject({ code: 'epochMismatch', review: true });
    expect((await watchRecoveryActions()).map((item) => item.kind)).toEqual(['evidence']);
  });
  it('validates shape rules and the envelope id', () => {
    const ok = mutation(1);
    expect(watchMutationV2Schema.safeParse(ok).success).toBe(true);
    const bad: Partial<WatchMutationV2>[] = [
      { changes: { reps: 8 }, expected: { reps: null } },
      { op: 'edit' },
      { expected: { completed: false } },
      { op: 'resolve', resolves: crypto.randomUUID(), keep: 'phone' },
      { op: 'undo' },
      { changes: {}, expected: {} },
    ];
    for (const patch of bad)
      expect(
        watchMutationV2Schema.safeParse({ ...ok, ...patch }).success,
        JSON.stringify(patch),
      ).toBe(false);
    expect(
      watchMutationV2Schema.safeParse({
        ...ok,
        op: 'resolve',
        resolves: crypto.randomUUID(),
        keep: 'phone',
        changes: {},
        expected: {},
      }).success,
    ).toBe(true);
  });
  it('rejects a mutation whose opId differs from the envelope id', async () => {
    expect(await applyWatchMutation(crypto.randomUUID(), mutation(1))).toMatchObject({
      state: 'rejected',
      code: 'invalid',
    });
  });
});

describe('review resolution keeps the non-conflicting part of the op', () => {
  // Phone typed reps 8 without ticking; the watch completed the set with reps 10.
  async function heldBackCompletion() {
    await phoneEdit((draft) => void (draft.results[0]!.sets[0]!.reps = 8));
    const m = mutation(1, { changes: { completed: true, reps: 10 } });
    const result = await apply(m);
    expect(result.state).toBe('conflict');
    expect(await firstSet()).toMatchObject({ completed: false, reps: 8 });
    return m;
  }
  it('lists the merged completion with the conflict and applies both from the phone', async () => {
    const m = await heldBackCompletion();
    const [review] = await openReviews(session.id);
    expect(review!.fields).toEqual([
      { field: 'completed', phone: false, requested: true, conflict: false },
      { field: 'reps', phone: 8, requested: 10, conflict: true },
    ]);
    const snapshot = await createWatchSnapshotV2(session.id, { phone: PHONE });
    expect(snapshot.reviews[0]!.fields.map((f) => [f.field, f.conflict])).toEqual([
      ['completed', false],
      ['reps', true],
    ]);
    expect(await resolveReview(m.opId, 'watch', { completed: false, reps: 8 })).toBe('applied');
    expect(await firstSet()).toMatchObject({ completed: true, reps: 10 });
  });
  it('applies the completion too when the watch resolves with its values', async () => {
    const m = await heldBackCompletion();
    const resolve = mutation(2, {
      op: 'resolve',
      resolves: m.opId,
      keep: 'watch',
      expected: { completed: false, reps: 8 },
      changes: { completed: true, reps: 10 },
    });
    expect(await apply(resolve)).toMatchObject({ state: 'committed', code: 'ok' });
    expect(await firstSet()).toMatchObject({ completed: true, reps: 10 });
  });
  it('keeping phone values leaves the set uncompleted, as the review said', async () => {
    const m = await heldBackCompletion();
    expect(await resolveReview(m.opId, 'phone')).toBe('kept');
    expect(await firstSet()).toMatchObject({ completed: false, reps: 8 });
  });
  it('fills in requested fields missing from a review stored before the flag', async () => {
    const m = await heldBackCompletion();
    const key = `sync:review:${m.opId}`;
    const stored = (await db.meta.get(key))!.value as { fields: unknown[] };
    await db.meta.put({
      key,
      value: { ...stored, fields: [{ field: 'reps', phone: 8, requested: 10 }] },
    });
    expect(await resolveReview(m.opId, 'watch', { completed: false, reps: 8 })).toBe('applied');
    expect(await firstSet()).toMatchObject({ completed: true, reps: 10 });
  });
});
