import type { ExerciseResult, SetResult, WorkoutSession } from '@/types';
import { canonical, WATCH_SET_FIELDS } from './protocol';

/**
 * The single three-way field merge (design §2.1), mirrored by MutationRules.merge in
 * Java and pinned by android/wear-link/src/test/resources/sync-v2/merge-cases.json.
 */

type Fields = Record<string, unknown>;

/** Numbers by value, null only equals null, booleans strictly, anything else as canonical JSON. */
export function same(a: unknown, b: unknown): boolean {
  const left = a === undefined ? null : a;
  const right = b === undefined ? null : b;
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  if (left === null || right === null) return left === right;
  if (typeof left !== 'object' && typeof right !== 'object') return left === right;
  return canonical(left) === canonical(right);
}

export type MergeOutcome = 'apply' | 'noop' | 'conflict';

export interface MergeResult<T extends Fields> {
  outcome: MergeOutcome;
  /** `current` with applied fields; unchanged on conflict or noop. */
  result: T;
  /** Conflicting fields: watch set fields first in protocol order, then the rest by name. */
  conflicts: string[];
}

const FIELD_ORDER = new Map<string, number>(WATCH_SET_FIELDS.map((field, i) => [field, i]));
export function fieldOrder(a: string, b: string): number {
  const x = FIELD_ORDER.get(a) ?? Infinity;
  const y = FIELD_ORDER.get(b) ?? Infinity;
  return x !== y ? x - y : a < b ? -1 : a > b ? 1 : 0;
}

export function mergeFields<T extends Fields>(
  current: T,
  expected: Fields,
  changes: Fields,
): MergeResult<T> {
  const conflicts: string[] = [];
  const applied: Fields = {};
  for (const field of Object.keys(changes)) {
    if (same(current[field], changes[field])) continue;
    if (same(current[field], expected[field])) applied[field] = changes[field];
    else conflicts.push(field);
  }
  conflicts.sort(fieldOrder);
  if (conflicts.length) return { outcome: 'conflict', result: current, conflicts };
  if (!Object.keys(applied).length) return { outcome: 'noop', result: current, conflicts };
  return { outcome: 'apply', result: { ...current, ...applied }, conflicts };
}

/* ------------------------------------------------------------------ */
/* Phone session patches (design §2.3)                                 */
/* ------------------------------------------------------------------ */

export interface FieldPatch {
  expected: Fields;
  changes: Fields;
}
export interface SetPatch extends FieldPatch {
  prescriptionId: string;
  setId: string;
}
export interface ExercisePatch extends FieldPatch {
  prescriptionId: string;
}
export type ScalarPatch = FieldPatch;
/** Adds or removes sets. Applies only while the stored set-id list still equals `base`. */
export interface StructurePatch {
  prescriptionId: string;
  base: string[];
  next: string[];
  /** Sets in `next` that are not in `base`, in full. */
  added: SetResult[];
}
export interface SessionPatch {
  opId: string;
  sets: SetPatch[];
  exercises: ExercisePatch[];
  session: ScalarPatch;
  structure: StructurePatch[];
  elapsedSeconds: number;
}

export const EXERCISE_PATCH_FIELDS = [
  'notes',
  'painDuring',
  'formGood',
  'videoViewed',
  'tempo',
  'substitutionExerciseId',
  'skippedReason',
] as const satisfies readonly (keyof ExerciseResult)[];
export const SESSION_PATCH_FIELDS = [
  'warmUp',
  'warmUpCompletedAt',
  'painBefore',
  'painAfter',
  'sessionNotes',
  'bodyweight',
] as const satisfies readonly (keyof WorkoutSession)[];

function diffFields(base: Fields, next: Fields, keys: Iterable<string>): FieldPatch {
  const patch: FieldPatch = { expected: {}, changes: {} };
  for (const key of keys) {
    if (same(base[key], next[key])) continue;
    patch.expected[key] = base[key] ?? null;
    patch.changes[key] = next[key] ?? null;
  }
  return patch;
}

const setKeys = (a: SetResult, b: SetResult) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => key !== 'id');
const ids = (sets: SetResult[]) => sets.map((set) => set.id!);
const changed = (patch: FieldPatch) => Object.keys(patch.changes).length > 0;

/** Sparse field-level changes from `base` to `next`; both must carry stable set IDs. */
export function diffSession(
  base: WorkoutSession,
  next: WorkoutSession,
  opId: string = crypto.randomUUID(),
): SessionPatch {
  const patch: SessionPatch = {
    opId,
    sets: [],
    exercises: [],
    session: diffFields(base as unknown as Fields, next as unknown as Fields, SESSION_PATCH_FIELDS),
    structure: [],
    elapsedSeconds: next.elapsedSeconds,
  };
  for (const after of next.results) {
    const before = base.results.find((row) => row.prescriptionId === after.prescriptionId);
    if (!before) continue;
    const exercise = diffFields(
      before as unknown as Fields,
      after as unknown as Fields,
      EXERCISE_PATCH_FIELDS,
    );
    if (changed(exercise))
      patch.exercises.push({ prescriptionId: after.prescriptionId, ...exercise });
    const baseIds = ids(before.sets);
    const nextIds = ids(after.sets);
    if (baseIds.join('\u0000') !== nextIds.join('\u0000'))
      patch.structure.push({
        prescriptionId: after.prescriptionId,
        base: baseIds,
        next: nextIds,
        added: after.sets.filter((set) => !baseIds.includes(set.id!)),
      });
    for (const set of after.sets) {
      const old = before.sets.find((row) => row.id === set.id);
      if (!old) continue;
      const fields = diffFields(
        old as unknown as Fields,
        set as unknown as Fields,
        setKeys(old, set),
      );
      if (changed(fields))
        patch.sets.push({ prescriptionId: after.prescriptionId, setId: set.id!, ...fields });
    }
  }
  return patch;
}

export function patchIsEmpty(patch: SessionPatch): boolean {
  return (
    !patch.sets.length &&
    !patch.exercises.length &&
    !patch.structure.length &&
    !changed(patch.session)
  );
}

export interface PatchConflict {
  kind: 'set' | 'exercise' | 'session' | 'structure';
  prescriptionId?: string;
  setId?: string;
  fields: string[];
}

export type PatchApplication =
  | { state: 'committed'; session: WorkoutSession; changed: boolean }
  | { state: 'conflict'; session: WorkoutSession; conflicts: PatchConflict[] };

const completedFrom = (sets: SetResult[]) => {
  const working = sets.filter((set) => !set.isWarmUp);
  return working.length > 0 && working.every((set) => set.completed);
};

/**
 * Applies a patch atomically with the shared merge rule: any conflicting field or
 * structure change rejects the whole patch. Elapsed time keeps the max rule.
 */
export function applySessionPatch(current: WorkoutSession, patch: SessionPatch): PatchApplication {
  const conflicts: PatchConflict[] = [];
  let changedAny = false;
  const scalar = mergeFields(
    current as unknown as Fields,
    patch.session.expected,
    patch.session.changes,
  );
  if (scalar.outcome === 'conflict') conflicts.push({ kind: 'session', fields: scalar.conflicts });
  if (scalar.outcome === 'apply') changedAny = true;
  const results = current.results.map((exercise) => {
    const id = exercise.prescriptionId;
    let next: ExerciseResult = exercise;
    let setsTouched = false;
    for (const structure of patch.structure.filter((row) => row.prescriptionId === id)) {
      if (ids(next.sets).join('\u0000') !== structure.base.join('\u0000')) {
        conflicts.push({ kind: 'structure', prescriptionId: id, fields: [] });
        continue;
      }
      const byId = new Map(next.sets.map((set) => [set.id!, set]));
      for (const set of structure.added) byId.set(set.id!, set);
      next = { ...next, sets: structure.next.flatMap((setId) => byId.get(setId) ?? []) };
      setsTouched = changedAny = true;
    }
    for (const row of patch.sets.filter((item) => item.prescriptionId === id)) {
      const set = next.sets.find((item) => item.id === row.setId);
      if (!set) {
        conflicts.push({ kind: 'set', prescriptionId: id, setId: row.setId, fields: [] });
        continue;
      }
      const merged = mergeFields(set as unknown as Fields, row.expected, row.changes);
      if (merged.outcome === 'conflict')
        conflicts.push({
          kind: 'set',
          prescriptionId: id,
          setId: row.setId,
          fields: merged.conflicts,
        });
      else if (merged.outcome === 'apply') {
        const replacement = merged.result as unknown as SetResult;
        next = {
          ...next,
          sets: next.sets.map((item) => (item.id === row.setId ? replacement : item)),
        };
        setsTouched = changedAny = true;
      }
    }
    for (const row of patch.exercises.filter((item) => item.prescriptionId === id)) {
      const merged = mergeFields(next as unknown as Fields, row.expected, row.changes);
      if (merged.outcome === 'conflict')
        conflicts.push({ kind: 'exercise', prescriptionId: id, fields: merged.conflicts });
      else if (merged.outcome === 'apply') {
        next = merged.result as unknown as ExerciseResult;
        changedAny = true;
      }
    }
    return setsTouched ? { ...next, completed: completedFrom(next.sets) } : next;
  });
  const missing = [...patch.sets, ...patch.exercises, ...patch.structure].filter(
    (row) => !current.results.some((exercise) => exercise.prescriptionId === row.prescriptionId),
  );
  for (const row of missing)
    conflicts.push({
      kind: 'setId' in row ? 'set' : 'exercise',
      prescriptionId: row.prescriptionId,
      fields: [],
    });
  if (conflicts.length) return { state: 'conflict', session: current, conflicts };
  const elapsedSeconds = Math.max(current.elapsedSeconds, patch.elapsedSeconds);
  return {
    state: 'committed',
    changed: changedAny,
    session: {
      ...(scalar.result as unknown as WorkoutSession),
      results,
      elapsedSeconds,
    },
  };
}
