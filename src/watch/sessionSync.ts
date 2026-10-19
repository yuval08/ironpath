import { db, nowIso } from '@/db/db';
import { withSessionIdentity } from '@/utils/sessionIdentity';
import { migrateRecord } from '@/db/migrations';
import { prescriptionGroups } from '@/utils/workoutExecution';
import { EXERCISES, exerciseName } from '@/data/exercises';
import type { ExercisePrescription, SetResult, WorkoutDay, WorkoutSession } from '@/types';
import { canonical, watchCommandSchema, watchSnapshotSchema } from './protocol';
import type { WatchResult, WatchSetState, WatchSnapshot } from './protocol';

export const WATCH_EPOCH_KEY = 'watch:epoch';
export const WATCH_SELECTED_KEY = 'watch:selected';
export const WATCH_CONTROL_KEY = 'watch:controlRevision';

export async function watchEpoch(): Promise<string> {
  const row = await db.meta.get(WATCH_EPOCH_KEY);
  if (typeof row?.value === 'string') return row.value;
  const value = crypto.randomUUID();
  await db.meta.put({ key: WATCH_EPOCH_KEY, value });
  return value;
}

export function setState(set: SetResult): WatchSetState {
  return {
    completed: set.completed,
    reps: set.reps,
    repsLeft: set.repsLeft,
    repsRight: set.repsRight,
    weight: set.weight,
    rpe: set.rpe,
    rir: set.rir,
  };
}

/** Same consecutive block/superset boundaries as the phone's exercise cards. */
export function executionSteps(
  day: WorkoutDay,
  session: WorkoutSession,
  unit: 'kg' | 'lb',
): WatchSnapshot['steps'] {
  const groups = prescriptionGroups(day);
  const steps: WatchSnapshot['steps'] = [];
  const append = (p: ExercisePrescription, set: SetResult, rest: number) => {
    const result = session.results.find((row) => row.prescriptionId === p.id)!;
    if (result.skippedReason) return;
    const exerciseId = result.substitutionExerciseId ?? result.exerciseId;
    const def = EXERCISES.find((exercise) => exercise.id === exerciseId);
    const working = result.sets.filter((row) => !row.isWarmUp);
    steps.push({
      setId: set.id!,
      prescriptionId: p.id,
      exerciseId,
      name: exerciseName(exerciseId),
      setNumber: set.setNumber,
      workingNumber: set.isWarmUp ? 0 : working.indexOf(set) + 1,
      workingTotal: working.length,
      isWarmUp: set.isWarmUp,
      entryStyle: p.entryStyle,
      loadType: def?.loadType ?? 'none',
      unit,
      target: result.plannedReps,
      recommendedWeight: result.recommendedWeight,
      band: set.band ?? null,
      restAfter: set.isWarmUp ? 0 : rest,
      supported: ['reps', 'repsPerSide'].includes(p.entryStyle),
      actual: setState(set),
    });
  };
  for (const prescriptions of groups) {
    const members = prescriptions
      .map((p) => ({ p, result: session.results.find((r) => r.prescriptionId === p.id) }))
      .filter((m) => m.result != null);
    const rounds = Math.min(...members.map((m) => m.p.sets));
    const groupRest = Math.max(0, ...members.map((m) => m.p.restSeconds));
    for (const { p, result } of members)
      for (const set of result!.sets.filter((s) => s.isWarmUp)) append(p, set, 0);
    for (let round = 0; round < rounds; round++) {
      for (const { p, result } of members) {
        const set = result!.sets.filter((s) => !s.isWarmUp)[round];
        if (set) append(p, set, p.restSeconds);
      }
    }
    for (const { p, result } of members) {
      for (const set of result!.sets.filter((s) => !s.isWarmUp).slice(rounds))
        append(p, set, groupRest);
    }
  }
  return steps;
}

export async function createWatchSnapshot(sessionId: string): Promise<WatchSnapshot> {
  return db.transaction('rw', db.sessions, db.plans, db.settings, db.meta, async () => {
    const raw = await db.sessions.get(sessionId);
    if (!raw || raw.status !== 'inProgress') throw new Error('Open an in-progress workout first.');
    const session = withSessionIdentity(migrateRecord(raw));
    if (!session.warmUpCompletedAt) throw new Error('Complete the warm-up on your phone first.');
    const plan = await db.plans.get(session.planId);
    const day = plan?.weeks.flatMap((week) => week.days).find((row) => row.id === session.dayId);
    if (!day) throw new Error('The workout plan is unavailable.');
    const settings = await db.settings.toCollection().first();
    const epoch = await watchEpoch();
    const prefix = `watch:sequence:${epoch}:`;
    const sequences = Object.fromEntries(
      (await db.meta.where('key').startsWith(prefix).toArray()).map((row) => [
        row.key.slice(prefix.length),
        row.value,
      ]),
    );
    const parsed = watchSnapshotSchema.safeParse({
      protocolVersion: 1,
      epoch,
      sessionId,
      revision: session.syncRevision ?? 0,
      title: day.title,
      status: 'inProgress',
      elapsedSeconds: session.elapsedSeconds,
      controlRevision: Number((await db.meta.get(WATCH_CONTROL_KEY))?.value ?? 0),
      vibrate: settings?.vibrateOnRestEnd ?? true,
      sequences,
      steps: executionSteps(day, session, settings?.weightUnit ?? 'lb'),
    });
    if (!parsed.success)
      throw new Error(
        'This workout contains values the watch cannot display. Review it on your phone.',
      );
    const snapshot = parsed.data;
    if (new Set(snapshot.steps.map((step) => step.setId)).size !== snapshot.steps.length)
      throw new Error('This workout contains duplicate set identities.');
    await db.sessions.put(session);
    return snapshot;
  });
}

/** Command effect and replay ledger commit atomically; transport ACKs happen afterwards. */
export async function applyWatchCommand(commandId: string, input: unknown): Promise<WatchResult> {
  const parsed = watchCommandSchema.safeParse(input);
  if (!parsed.success) {
    const context = input as { epoch?: unknown; sessionId?: unknown } | null;
    return {
      commandId,
      epoch: typeof context?.epoch === 'string' ? context.epoch : '',
      sessionId: typeof context?.sessionId === 'string' ? context.sessionId : '',
      state: 'rejected',
      revision: 0,
      reason: 'Unsupported or invalid command.',
    };
  }
  const command = parsed.data;
  return db.transaction('rw', db.sessions, db.plans, db.meta, async () => {
    // A prior committed result describes the pre-restore timeline, not restored history.
    // Check the epoch before consulting replay evidence retained across restore.
    if (command.epoch !== (await watchEpoch())) {
      const result: WatchResult = {
        commandId,
        epoch: command.epoch,
        sessionId: command.sessionId,
        state: 'rejected',
        revision: 0,
        reason: 'The phone database was reset or restored. Start a fresh handoff.',
      };
      const key = `watch:recovery:${commandId}`;
      if (!(await db.meta.get(key))) await db.meta.put({ key, value: { command, result } });
      return result;
    }
    const ledgerKey = `watch:command:${commandId}`;
    const fingerprint = canonical(command);
    const old = (await db.meta.get(ledgerKey))?.value as
      { fingerprint: string; result: WatchResult } | undefined;
    if (old)
      return old.fingerprint === fingerprint
        ? old.result
        : {
            commandId,
            epoch: command.epoch,
            sessionId: command.sessionId,
            state: 'rejected',
            revision: 0,
            reason: 'Command ID was reused with different content.',
          };
    const raw = await db.sessions.get(command.sessionId);
    const session = raw ? withSessionIdentity(migrateRecord(raw)) : undefined;
    const revision = session?.syncRevision ?? 0;
    const result: WatchResult = {
      commandId,
      epoch: command.epoch,
      sessionId: command.sessionId,
      state: 'rejected',
      revision,
      reason: '',
    };
    const sequenceKey = `watch:sequence:${command.epoch}:${command.deviceId}`;
    const last = Number((await db.meta.get(sequenceKey))?.value ?? 0);
    if (command.epoch !== (await watchEpoch()))
      result.reason = 'The phone database was reset or restored. Start a fresh handoff.';
    else if (command.sequence > last + 1)
      return { ...result, state: 'deferred', reason: 'Waiting for an earlier command.' };
    else if (command.sequence <= last)
      result.reason = 'Sequence was already used by another command.';
    else if (!session || session.status !== 'inProgress')
      result.reason = 'The workout was removed or closed.';
    else {
      const exercise = session.results.find((row) => row.prescriptionId === command.prescriptionId);
      const set = exercise?.sets.find((row) => row.id === command.setId);
      const plan = await db.plans.get(session.planId);
      const prescription = plan?.weeks
        .flatMap((week) => week.days)
        .find((day) => day.id === session.dayId)
        ?.prescriptions.find((row) => row.id === command.prescriptionId);
      if (!exercise || !set) result.reason = 'The target set no longer exists.';
      else if (!prescription || !['reps', 'repsPerSide'].includes(prescription.entryStyle))
        result.reason = 'Log this exercise on the phone.';
      else if (
        command.baseRevision > revision ||
        canonical(setState(set)) !== canonical(command.expected) ||
        (exercise.substitutionExerciseId ?? exercise.exerciseId) !== command.exerciseId ||
        exercise.skippedReason
      ) {
        result.state = 'conflict';
        result.reason = 'This set changed on the phone. Review the pending watch action.';
      } else {
        const nextSet = { ...set, ...command.changes };
        const sets = exercise.sets.map((row) => (row.id === command.setId ? nextSet : row));
        const working = sets.filter((row) => !row.isWarmUp);
        const nextExercise = {
          ...exercise,
          sets,
          completed: working.length > 0 && working.every((row) => row.completed),
        };
        const next = {
          ...session,
          syncRevision: revision + 1,
          updatedAt: nowIso(),
          results: session.results.map((row) =>
            row.prescriptionId === exercise.prescriptionId ? nextExercise : row,
          ),
        };
        await db.sessions.put(next);
        result.state = 'committed';
        result.revision = revision + 1;
      }
    }
    await db.meta.put({ key: ledgerKey, value: { fingerprint, command, result } });
    // Terminal conflicts/rejections consume their sequence too, so later independent sets can progress.
    if (command.epoch === (await watchEpoch()) && command.sequence === last + 1)
      await db.meta.put({ key: sequenceKey, value: command.sequence });
    return result;
  });
}
