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
  createWatchSnapshot,
  executionSteps,
  setState,
  WATCH_EPOCH_KEY,
} from './sessionSync';
import { packet, watchCommandSchema } from './protocol';
import type { WatchCommand } from './protocol';

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
