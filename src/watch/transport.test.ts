import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { makePlan, makeSettings } from '@/test/factories';
import { createSession, getSession, saveSession } from '@/db/repository';
import { createWatchSnapshot, setState } from './sessionSync';
import {
  reconcileWatchInbox,
  takePhoneControl,
  prepareWatchFinish,
  consumeTransferredRest,
} from './transport';
import { watchRecoveryActions, reviewWatchAction } from './recovery';
import { packet } from './protocol';

const native = vi.hoisted(() => ({
  inspectWorkout: vi.fn(),
  completeWorkoutCommand: vi.fn(),
  flushWorkout: vi.fn(),
  publishWorkout: vi.fn(),
  controlWorkout: vi.fn(),
}));
vi.mock('@/utils/watchLink', () => ({ watchLinkSupported: () => true, WatchLink: native }));

beforeEach(async () => {
  vi.resetAllMocks();
  await Promise.all([db.sessions.clear(), db.plans.clear(), db.settings.clear(), db.meta.clear()]);
  native.flushWorkout.mockResolvedValue(undefined);
});

it('refreshes phone edits after confirmed handoff without replacing the manual confirmation ID', async () => {
  const plan = makePlan();
  const day = plan.weeks[0]!.days[0]!;
  await db.plans.put(plan);
  await db.settings.put(makeSettings());
  let session = await createSession(plan, day);
  session = (await saveSession({ ...session, warmUpCompletedAt: new Date().toISOString() }))!;
  const snapshot = await createWatchSnapshot(session.id);
  const id = crypto.randomUUID();
  await db.meta.put({
    key: 'watch:selected',
    value: {
      sessionId: session.id,
      epoch: snapshot.epoch,
      snapshotId: id,
      revision: snapshot.revision,
      confirmed: false,
    },
  });
  await saveSession({ ...session, sessionNotes: 'phone edit' });
  native.inspectWorkout.mockResolvedValue({ inbox: [], confirmation: null });
  await reconcileWatchInbox();
  expect(native.publishWorkout).not.toHaveBeenCalled();
  native.inspectWorkout.mockResolvedValue({
    inbox: [],
    confirmation: { id, body: { state: 'received' } },
  });
  native.publishWorkout.mockResolvedValue(undefined);
  await reconcileWatchInbox();
  expect(native.publishWorkout).toHaveBeenCalledOnce();
  expect(native.publishWorkout.mock.calls[0]![0].packet.body.revision).toBe(snapshot.revision + 1);
  expect((await db.meta.get('watch:selected'))!.value).toMatchObject({
    snapshotId: id,
    confirmed: true,
    revision: snapshot.revision + 1,
  });
});

it('retries after a native result-write failure without applying the database effect twice', async () => {
  const plan = makePlan();
  const day = plan.weeks[0]!.days[0]!;
  await db.plans.put(plan);
  await db.settings.put(makeSettings());
  let session = await createSession(plan, day);
  session = (await saveSession({ ...session, warmUpCompletedAt: new Date().toISOString() }))!;
  const snapshot = await createWatchSnapshot(session.id);
  const target = snapshot.steps.find((step) => step.supported)!;
  const exercise = session.results.find((row) => row.prescriptionId === target.prescriptionId)!;
  const set = exercise.sets.find((row) => row.id === target.setId)!;
  const message = packet('command', {
    protocolVersion: 1,
    epoch: snapshot.epoch,
    sessionId: session.id,
    deviceId: crypto.randomUUID(),
    sequence: 1,
    baseRevision: session.syncRevision ?? 0,
    action: 'set',
    prescriptionId: exercise.prescriptionId,
    exerciseId: exercise.exerciseId,
    setId: set.id,
    expected: setState(set),
    changes: { completed: true, reps: 8 },
  });
  native.inspectWorkout.mockResolvedValue({ inbox: [{ peer: 'watch', packet: message }] });
  native.completeWorkoutCommand
    .mockRejectedValueOnce(new Error('Native storage full'))
    .mockResolvedValue(undefined);
  await expect(reconcileWatchInbox()).rejects.toThrow('Native storage full');
  const revision = (await getSession(session.id))!.syncRevision;
  await reconcileWatchInbox();
  expect((await getSession(session.id))!.syncRevision).toBe(revision);
  expect(native.completeWorkoutCommand.mock.calls[1]![0].packet.body.state).toBe('committed');
});

async function handedOff() {
  const plan = makePlan();
  const day = plan.weeks[0]!.days[0]!;
  await db.plans.put(plan);
  await db.settings.put(makeSettings());
  let session = await createSession(plan, day);
  session = (await saveSession({ ...session, warmUpCompletedAt: new Date().toISOString() }))!;
  const snapshot = await createWatchSnapshot(session.id);
  await db.meta.put({
    key: 'watch:selected',
    value: {
      sessionId: session.id,
      epoch: snapshot.epoch,
      snapshotId: crypto.randomUUID(),
      revision: snapshot.revision,
      confirmed: true,
      owner: 'watch',
    },
  });
  return { session, snapshot };
}

it('takes phone control only after the native pause checkpoint has been canonically imported', async () => {
  const { session, snapshot } = await handedOff();
  const deviceId = crypto.randomUUID();
  const target = snapshot.steps.find((s) => s.supported)!;
  const command = packet('command', {
    protocolVersion: 1,
    epoch: snapshot.epoch,
    sessionId: session.id,
    deviceId,
    sequence: 1,
    baseRevision: snapshot.revision,
    action: 'set',
    prescriptionId: target.prescriptionId,
    setId: target.setId,
    exerciseId: target.exerciseId,
    expected: target.actual,
    changes: { completed: true, reps: 9 },
  });
  let controlId: string | undefined;
  native.controlWorkout.mockImplementation(async ({ packet }) => {
    controlId = packet.id;
  });
  native.inspectWorkout.mockImplementation(async () => ({
    inbox: controlId ? [{ peer: 'watch', packet: command }] : [],
    controlConfirmation: controlId
      ? {
          id: controlId,
          body: { state: 'received', deviceId, sequence: 1, restRemainingMs: 12345 },
        }
      : null,
  }));
  await takePhoneControl(session.id);
  expect((await db.meta.get('watch:selected'))!.value).toMatchObject({
    owner: 'phone',
    offline: false,
  });
  expect(
    (await getSession(session.id))!.results
      .flatMap((r) => r.sets)
      .find((s) => s.id === target.setId)!.reps,
  ).toBe(9);
  expect(native.publishWorkout).not.toHaveBeenCalled();
  expect((await db.meta.get('watch:selected'))!.value).toMatchObject({
    restTransfer: { seconds: 13 },
  });
  expect(await consumeTransferredRest(session.id, controlId!)).toBe(13);
  await expect(consumeTransferredRest(session.id, controlId!)).rejects.toThrow('no longer');
});

it('does not claim a clean finish when the paused watch action conflicts', async () => {
  const { session, snapshot } = await handedOff();
  const deviceId = crypto.randomUUID();
  const target = snapshot.steps.find((s) => s.supported)!;
  const command = packet('command', {
    protocolVersion: 1,
    epoch: snapshot.epoch,
    sessionId: session.id,
    deviceId,
    sequence: 1,
    baseRevision: snapshot.revision,
    action: 'set',
    prescriptionId: target.prescriptionId,
    setId: target.setId,
    exerciseId: target.exerciseId,
    expected: { ...target.actual, reps: 999 },
    changes: { reps: 8 },
  });
  let id: string | undefined;
  native.controlWorkout.mockImplementation(async ({ packet }) => {
    id = packet.id;
  });
  native.inspectWorkout.mockImplementation(async () => ({
    inbox: id ? [{ peer: 'watch', packet: command }] : [],
    controlConfirmation: id ? { id, body: { state: 'received', deviceId, sequence: 1 } } : null,
  }));
  await expect(prepareWatchFinish(session.id)).rejects.toThrow('Review');
  const actions = await watchRecoveryActions(session.id);
  expect(actions[0]!.kind === 'legacy' && actions[0]!.command.changes.reps).toBe(8);
  await reviewWatchAction(actions[0]!.id);
  expect(await watchRecoveryActions(session.id)).toEqual([]);
  // Original request remains available after explicit review.
  expect((await db.meta.get(actions[0]!.id))!.value).toMatchObject({
    command: { changes: { reps: 8 } },
  });
});

it('queues durable closure for a completed or restored native handoff', async () => {
  const { session, snapshot } = await handedOff();
  const selected = (await db.meta.get('watch:selected'))!.value as { snapshotId: string };
  native.inspectWorkout.mockResolvedValue({
    inbox: [],
    published: packet('snapshot', snapshot),
    confirmation: { id: selected.snapshotId, body: { state: 'received' } },
  });
  native.controlWorkout.mockResolvedValue(undefined);
  await db.sessions.update(session.id, { status: 'completed' });
  await reconcileWatchInbox();
  expect(native.controlWorkout.mock.calls[0]![0].packet.body).toMatchObject({
    owner: 'closed',
    epoch: snapshot.epoch,
    sessionId: session.id,
  });
  await reconcileWatchInbox();
  expect(native.controlWorkout).toHaveBeenCalledOnce();
  expect((await db.meta.get('watch:selected'))!.value).toMatchObject({ owner: 'closed' });
});

it('retains rejected pre-restore values for review without changing restored history', async () => {
  const { session, snapshot } = await handedOff();
  const target = snapshot.steps.find((s) => s.supported)!;
  const command = packet('command', {
    protocolVersion: 1,
    epoch: snapshot.epoch,
    sessionId: session.id,
    deviceId: crypto.randomUUID(),
    sequence: 1,
    baseRevision: snapshot.revision,
    action: 'set',
    prescriptionId: target.prescriptionId,
    setId: target.setId,
    exerciseId: target.exerciseId,
    expected: target.actual,
    changes: { reps: 17 },
  });
  await db.meta.put({ key: 'watch:epoch', value: crypto.randomUUID() });
  native.inspectWorkout.mockResolvedValue({ inbox: [{ peer: 'watch', packet: command }] });
  await reconcileWatchInbox();
  const recovered = await watchRecoveryActions();
  expect(recovered[0]!.kind === 'legacy' && recovered[0]!.command.changes.reps).toBe(17);
  await reviewWatchAction(recovered[0]!.id);
  await reconcileWatchInbox();
  expect(await watchRecoveryActions()).toEqual([]);
  expect((await getSession(session.id))!.syncRevision).toBe(session.syncRevision);
});

it('refuses finish when a pause ACK arrives before an unreceived command, then resumes from the same checkpoint', async () => {
  const { session } = await handedOff();
  const deviceId = crypto.randomUUID();
  let id: string | undefined;
  native.controlWorkout.mockImplementation(async ({ packet }) => {
    id = packet.id;
  });
  native.inspectWorkout.mockImplementation(async () => ({
    inbox: [],
    controlConfirmation: id ? { id, body: { state: 'received', deviceId, sequence: 1 } } : null,
  }));
  await expect(prepareWatchFinish(session.id)).rejects.toThrow('has not confirmed');
  expect((await db.meta.get('watch:selected'))!.value).toMatchObject({ owner: 'pausing' });
  expect((await getSession(session.id))!.status).toBe('inProgress');
  // Simulate successful canonical import on the next foreground reconciliation.
  const epoch = (await db.meta.get('watch:epoch'))!.value;
  await db.meta.put({ key: `watch:sequence:${epoch}:${deviceId}`, value: 1 });
  await takePhoneControl(session.id);
  expect(native.controlWorkout).toHaveBeenCalledOnce();
  expect((await db.meta.get('watch:selected'))!.value).toMatchObject({ owner: 'phone' });
}, 15000);
