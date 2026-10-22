import { db, nowIso } from '@/db/db';
import { withSessionIdentity } from '@/utils/sessionIdentity';
import { migrateRecord } from '@/db/migrations';
import { prescriptionGroups } from '@/utils/workoutExecution';
import { EXERCISES, exerciseName } from '@/data/exercises';
import { bandName } from '@/utils/doubleProgression';
import type { BandLabels } from '@/utils/doubleProgression';
import type {
  ExercisePrescription,
  ExerciseResult,
  SetResult,
  UserSettings,
  WorkoutDay,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';
import {
  canonical,
  WATCH_SET_FIELDS,
  watchCommandSchema,
  watchMutationV2Schema,
  watchSnapshotSchema,
  watchSnapshotV2Schema,
} from './protocol';
import type {
  ResultCode,
  WatchMutationV2,
  WatchResult,
  WatchResultV2,
  WatchSetState,
  WatchSnapshot,
  WatchSnapshotV2,
  WatchStepV2,
} from './protocol';
import { mergeFields } from './mutations';
import {
  getReview,
  newReview,
  openReviews,
  putReview,
  resolveReviewRecord,
  reviewFields,
  allReviewFields,
} from './reviews';
import type { ReviewRecord } from './reviews';

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

type StepV1 = WatchSnapshot['steps'][number];
interface OrderedStep {
  step: StepV1;
  prescription: ExercisePrescription;
  group: number;
}

/** Same consecutive block/superset boundaries as the phone's exercise cards. */
function orderedSteps(day: WorkoutDay, session: WorkoutSession, unit: 'kg' | 'lb'): OrderedStep[] {
  const groups = prescriptionGroups(day);
  const steps: OrderedStep[] = [];
  const append = (p: ExercisePrescription, set: SetResult, rest: number, group: number) => {
    const result = session.results.find((row) => row.prescriptionId === p.id)!;
    if (result.skippedReason) return;
    const exerciseId = result.substitutionExerciseId ?? result.exerciseId;
    const def = EXERCISES.find((exercise) => exercise.id === exerciseId);
    const working = result.sets.filter((row) => !row.isWarmUp);
    steps.push({
      prescription: p,
      group,
      step: {
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
      },
    });
  };
  groups.forEach((prescriptions, group) => {
    const members = prescriptions
      .map((p) => ({ p, result: session.results.find((r) => r.prescriptionId === p.id) }))
      .filter((m) => m.result != null);
    const rounds = Math.min(...members.map((m) => m.p.sets));
    const groupRest = Math.max(0, ...members.map((m) => m.p.restSeconds));
    for (const { p, result } of members)
      for (const set of result!.sets.filter((s) => s.isWarmUp)) append(p, set, 0, group);
    for (let round = 0; round < rounds; round++) {
      for (const { p, result } of members) {
        const set = result!.sets.filter((s) => !s.isWarmUp)[round];
        if (set) append(p, set, p.restSeconds, group);
      }
    }
    for (const { p, result } of members) {
      for (const set of result!.sets.filter((s) => !s.isWarmUp).slice(rounds))
        append(p, set, groupRest, group);
    }
  });
  return steps;
}

export function executionSteps(
  day: WorkoutDay,
  session: WorkoutSession,
  unit: 'kg' | 'lb',
): WatchSnapshot['steps'] {
  return orderedSteps(day, session, unit).map((row) => row.step);
}

/** v1 ordering plus superset slot, group index, band display label and review flag. */
export function executionStepsV2(
  day: WorkoutDay,
  session: WorkoutSession,
  unit: 'kg' | 'lb',
  bandLabels?: BandLabels,
  reviewSetIds: ReadonlySet<string> = new Set(),
): WatchStepV2[] {
  return orderedSteps(day, session, unit).map(({ step, prescription, group }) => ({
    ...step,
    slot: prescription.slot?.slice(0, 8) ?? null,
    group,
    bandLabel:
      step.band && step.band !== 'none'
        ? bandName(step.band as Parameters<typeof bandName>[0], bandLabels).slice(0, 40)
        : null,
    review: reviewSetIds.has(step.setId),
  }));
}

interface SnapshotSource {
  session: WorkoutSession;
  day: WorkoutDay;
  settings: UserSettings | undefined;
  epoch: string;
  sequences: Record<string, number>;
  controlRevision: number;
}

/** Call inside a transaction over sessions, plans, settings and meta. */
async function snapshotSource(sessionId: string): Promise<SnapshotSource> {
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
      Number(row.value),
    ]),
  );
  const controlRevision = Number((await db.meta.get(WATCH_CONTROL_KEY))?.value ?? 0);
  return { session, day, settings, epoch, sequences, controlRevision };
}

const UNDISPLAYABLE =
  'This workout contains values the watch cannot display. Review it on your phone.';

export async function createWatchSnapshot(sessionId: string): Promise<WatchSnapshot> {
  return db.transaction('rw', db.sessions, db.plans, db.settings, db.meta, async () => {
    const { session, day, settings, epoch, sequences, controlRevision } =
      await snapshotSource(sessionId);
    const parsed = watchSnapshotSchema.safeParse({
      protocolVersion: 1,
      epoch,
      sessionId,
      revision: session.syncRevision ?? 0,
      title: day.title,
      status: 'inProgress',
      elapsedSeconds: session.elapsedSeconds,
      controlRevision,
      vibrate: settings?.vibrateOnRestEnd ?? true,
      sequences,
      steps: executionSteps(day, session, settings?.weightUnit ?? 'lb'),
    });
    if (!parsed.success) throw new Error(UNDISPLAYABLE);
    const snapshot = parsed.data;
    if (new Set(snapshot.steps.map((step) => step.setId)).size !== snapshot.steps.length)
      throw new Error('This workout contains duplicate set identities.');
    await db.sessions.put(session);
    return snapshot;
  });
}

export interface SnapshotV2Options {
  freeze?: WatchSnapshotV2['freeze'];
  phone: WatchSnapshotV2['phone'];
  /** Phone stopwatch running at capture; defaults to "warm-up done". */
  elapsedRunning?: boolean;
}

function liveSet(session: WorkoutSession, setId: string) {
  for (const exercise of session.results) {
    const set = exercise.sets.find((row) => row.id === setId);
    if (set) return { exercise, set };
  }
  return undefined;
}

/** Built only from canonical data; reviews come from the phone review store (§1.4). */
export async function createWatchSnapshotV2(
  sessionId: string,
  options: SnapshotV2Options,
): Promise<WatchSnapshotV2> {
  return db.transaction('rw', db.sessions, db.plans, db.settings, db.meta, async () => {
    const { session, day, settings, epoch, sequences, controlRevision } =
      await snapshotSource(sessionId);
    const reviews = (await openReviews(sessionId)).slice(0, 50);
    const parsed = watchSnapshotV2Schema.safeParse({
      protocolVersion: 2,
      epoch,
      sessionId,
      revision: session.syncRevision ?? 0,
      controlRevision,
      title: day.title,
      status: 'inProgress',
      elapsedSeconds: session.elapsedSeconds,
      elapsedRunning: options.elapsedRunning ?? true,
      capturedAtWall: Date.now(),
      vibrate: settings?.vibrateOnRestEnd ?? true,
      sequences,
      freeze: options.freeze ?? null,
      reviews: reviews.map((review) => {
        const live = liveSet(session, review.setId)?.set;
        return {
          id: review.id,
          setId: review.setId,
          origin: review.origin,
          code: review.code,
          reason: review.reason.slice(0, 512),
          fields: allReviewFields(review)
            .filter((row) => (WATCH_SET_FIELDS as readonly string[]).includes(row.field))
            .map((row) => ({
              field: row.field,
              phone: live ? ((live as Record<string, unknown>)[row.field] ?? null) : row.phone,
              requested: row.requested,
              conflict: row.conflict,
            })),
        };
      }),
      phone: options.phone,
      steps: executionStepsV2(
        day,
        session,
        settings?.weightUnit ?? 'lb',
        settings?.bandLabels,
        new Set(reviews.map((review) => review.setId)),
      ),
    });
    if (!parsed.success) throw new Error(UNDISPLAYABLE);
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

/* ------------------------------------------------------------------ */
/* v2 mutations (design §2.2)                                          */
/* ------------------------------------------------------------------ */

export type MutationOutcome = WatchResultV2 | { state: 'deferred'; opId: string };

const REASONS: Partial<Record<ResultCode, string>> = {
  fieldConflict: 'This set changed on the other device. Review it before logging it again.',
  setMissing: 'The target set no longer exists.',
  exerciseChanged: 'This exercise was substituted on the phone.',
  exerciseSkipped: 'This exercise was skipped on the phone.',
  unsupportedStyle: 'Log this exercise on the phone.',
  sessionClosed: 'The workout was removed or closed.',
  epochMismatch: 'The phone database was reset or restored. Start a fresh handoff.',
  sequenceReused: 'Sequence was already used by another command.',
  idReused: 'Command ID was reused with different content.',
  invalid: 'Unsupported or invalid command.',
};

function prescriptionFor(plan: WorkoutPlan | undefined, session: WorkoutSession, id: string) {
  return plan?.weeks
    .flatMap((week) => week.days)
    .find((day) => day.id === session.dayId)
    ?.prescriptions.find((row) => row.id === id);
}

const performed = (exercise: ExerciseResult) =>
  exercise.substitutionExerciseId ?? exercise.exerciseId;

/**
 * Canonical acceptance of a v2 watch mutation. Effect, ledger, sequence and review
 * commit in one transaction; the native result is queued by the caller afterwards.
 */
export async function applyWatchMutation(opId: string, input: unknown): Promise<MutationOutcome> {
  const context = (input ?? {}) as { epoch?: unknown; sessionId?: unknown };
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.length <= max ? value : '';
  const outcome = (
    state: WatchResultV2['state'],
    code: ResultCode,
    extra: Partial<WatchResultV2> = {},
  ): WatchResultV2 => ({
    opId,
    epoch: text(context.epoch, 36),
    sessionId: text(context.sessionId, 512),
    state,
    code,
    revision: 0,
    reason: REASONS[code] ?? '',
    review: false,
    fields: [],
    ...extra,
  });
  const parsed = watchMutationV2Schema.safeParse(input);
  if (!parsed.success || parsed.data.opId !== opId) return outcome('rejected', 'invalid');
  const mutation = parsed.data;
  return db.transaction('rw', db.sessions, db.plans, db.meta, async () => {
    if (mutation.epoch !== (await watchEpoch())) {
      const result = outcome('rejected', 'epochMismatch', { review: true });
      const key = `watch:recovery:${opId}`;
      if (!(await db.meta.get(key)))
        await db.meta.put({ key, value: { command: mutation, result } });
      return result;
    }
    const ledgerKey = `watch:command:${opId}`;
    const fingerprint = canonical(mutation);
    const old = (await db.meta.get(ledgerKey))?.value as
      { fingerprint: string; result: WatchResultV2 } | undefined;
    if (old) return old.fingerprint === fingerprint ? old.result : outcome('rejected', 'idReused');
    const sequenceKey = `watch:sequence:${mutation.epoch}:${mutation.deviceId}`;
    const last = Number((await db.meta.get(sequenceKey))?.value ?? 0);
    if (mutation.sequence > last + 1) return { state: 'deferred' as const, opId };
    const result = await decideMutation(mutation, last);
    await db.meta.put({ key: ledgerKey, value: { fingerprint, command: mutation, result } });
    // Terminal conflicts/rejections consume their sequence too (shared with v1).
    if (mutation.sequence === last + 1)
      await db.meta.put({ key: sequenceKey, value: mutation.sequence });
    return result;
  });
}

/** Steps 4–8 of §2.2; writes the effect and any review record. */
async function decideMutation(mutation: WatchMutationV2, last: number): Promise<WatchResultV2> {
  const base = (
    state: WatchResultV2['state'],
    code: ResultCode,
    revision: number,
    extra: Partial<WatchResultV2> = {},
  ): WatchResultV2 => ({
    opId: mutation.opId,
    epoch: mutation.epoch,
    sessionId: mutation.sessionId,
    state,
    code,
    revision,
    reason: REASONS[code] ?? '',
    review: false,
    fields: [],
    ...extra,
  });
  if (mutation.sequence <= last) return base('rejected', 'sequenceReused', 0);
  const raw = await db.sessions.get(mutation.sessionId);
  const session = raw ? withSessionIdentity(migrateRecord(raw)) : undefined;
  const revision = session?.syncRevision ?? 0;
  const { target } = mutation;
  const record = async (
    code: ResultCode,
    fields: ReviewRecord['fields'] = [],
    exerciseId = target.exerciseId,
  ) => {
    await putReview(
      newReview({
        id: mutation.opId,
        origin: 'watch',
        sessionId: mutation.sessionId,
        setId: target.setId,
        prescriptionId: target.prescriptionId,
        exerciseId,
        code,
        reason: REASONS[code] ?? '',
        fields,
        expected: mutation.expected,
        requested: mutation.changes,
      }),
    );
  };
  if (!session || session.status !== 'inProgress') {
    // A late resolve has nothing new to keep; the original review stays as evidence.
    if (mutation.op !== 'resolve') await record('sessionClosed');
    return base('rejected', 'sessionClosed', revision, { review: true });
  }
  let resolving: ReviewRecord | undefined;
  if (mutation.op === 'resolve') {
    resolving = await getReview(mutation.resolves!);
    if (!resolving || resolving.resolution) return base('committed', 'noop', revision);
    if (mutation.keep === 'phone') {
      await resolveReviewRecord(resolving.id, 'kept', 'watch');
      return base('committed', 'ok', revision);
    }
  }
  /** A failed conditional resolve supersedes the old review with a fresh one. */
  const refuse = async (
    state: 'rejected' | 'conflict',
    code: ResultCode,
    fields: ReviewRecord['fields'] = [],
    exerciseId?: string,
  ) => {
    if (resolving) await resolveReviewRecord(resolving.id, 'superseded', 'watch');
    await record(code, fields, exerciseId);
    return base(state, code, revision, {
      review: true,
      fields: fields as WatchResultV2['fields'],
    });
  };
  const exercise = session.results.find((row) => row.prescriptionId === target.prescriptionId);
  const set = exercise?.sets.find((row) => row.id === target.setId);
  const prescription = prescriptionFor(
    await db.plans.get(session.planId),
    session,
    target.prescriptionId,
  );
  if (!exercise || !set || !prescription) return refuse('rejected', 'setMissing');
  if (performed(exercise) !== target.exerciseId)
    return refuse('conflict', 'exerciseChanged', [], performed(exercise));
  if (exercise.skippedReason) return refuse('rejected', 'exerciseSkipped');
  if (!['reps', 'repsPerSide'].includes(prescription.entryStyle))
    return refuse('rejected', 'unsupportedStyle');
  const current = setState(set);
  const merged = mergeFields(current, mutation.expected, mutation.changes);
  if (merged.outcome === 'conflict')
    return refuse(
      'conflict',
      'fieldConflict',
      reviewFields(current, mutation.changes, merged.conflicts),
    );
  if (resolving) await resolveReviewRecord(resolving.id, 'applied', 'watch');
  if (merged.outcome === 'noop') return base('committed', 'noop', revision);
  const sets = exercise.sets.map((row) => (row.id === set.id ? { ...row, ...merged.result } : row));
  const working = sets.filter((row) => !row.isWarmUp);
  await db.sessions.put({
    ...session,
    syncRevision: revision + 1,
    updatedAt: nowIso(),
    results: session.results.map((row) =>
      row.prescriptionId === exercise.prescriptionId
        ? { ...exercise, sets, completed: working.length > 0 && working.every((s) => s.completed) }
        : row,
    ),
  });
  return base('committed', 'ok', revision + 1);
}
