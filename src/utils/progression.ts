import { exerciseName, getExercise } from '@/data/exercises';
import { newId, nowIso } from '@/db/db';
import { SCHEMA_VERSION } from '@/types';
import type {
  ExercisePrescription,
  ExerciseResult,
  ProgressionSuggestion,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';
import {
  bandName,
  evaluateDoubleProgression,
  workingSets,
  type ProgressionVerdict,
} from './doubleProgression';
import { performedExerciseId, setReps } from './stats';

/**
 * Progression is *suggested*, never applied automatically. A suggestion fires when
 * the same exercise clears every gate below in at least two sessions:
 *   - all planned working sets completed (ramp sets are ignored)
 *   - form marked good
 *   - pain during the exercise 0-2 (or not reported)
 *   - every recorded RPE <= 7
 *
 * Double-progression prescriptions bypass this heuristic entirely — see
 * `evaluateDoubleProgression`, which needs a single qualifying session.
 */
export const MIN_SUCCESSFUL_SESSIONS = 2;

export function isSuccessfulResult(result: ExerciseResult): boolean {
  if (result.skippedReason) return false;
  if (!result.completed) return false;
  const sets = workingSets(result);
  const allSetsDone = sets.length >= result.plannedSets && sets.every((s) => s.completed);
  if (!allSetsDone) return false;
  if (result.formGood !== true) return false;
  if (result.painDuring != null && result.painDuring > 2) return false;
  const rpes = sets.map((s) => s.rpe).filter((v): v is number => typeof v === 'number');
  if (rpes.some((r) => r > 7)) return false;
  return true;
}

interface Recommendation {
  kind: ProgressionSuggestion['kind'];
  text: string;
}

export function recommendationFor(exerciseId: string): Recommendation {
  const def = getExercise(exerciseId);
  switch (exerciseId) {
    case 'strict-pull-up':
    case 'chin-up':
      return { kind: 'reps', text: 'Add one clean rep to your best set, or add a set of singles.' };
    case 'band-assisted-pull-up':
      return { kind: 'assistance', text: 'Move to a thinner band — use slightly less assistance.' };
    case 'negative-pull-up':
      return { kind: 'time', text: 'Extend the lowering by 1-2 seconds, then add a rep.' };
    case 'standard-push-up':
      return { kind: 'angle', text: 'Raise the feet slightly, or add 1-2 reps per set.' };
    case 'decline-push-up':
    case 'pike-push-up':
    case 'pike-push-up-elevated':
      return { kind: 'angle', text: 'Increase the elevation slightly, or add 1-2 reps per set.' };
    case 'dead-hang':
    case 'single-leg-balance':
    case 'deep-squat-hold':
      return { kind: 'time', text: 'Add 5 seconds to each hold.' };
    case 'farmer-carry':
    case 'suitcase-carry':
      return { kind: 'weight', text: 'Add 5 seconds, then increase the carry weight slightly.' };
    case 'backward-treadmill-walk':
      return {
        kind: 'treadmill',
        text: 'Add 2 minutes, or increase speed by 0.1-0.2 mph once the duration is easy.',
      };
    case 'forward-treadmill-walk':
      return { kind: 'treadmill', text: 'Add 2-3 minutes at the same comfortable pace.' };
    case 'bear-crawl':
    case 'quadruped-shoulder-tap':
      return { kind: 'round', text: 'Add one round, or 5 seconds per round.' };
    default:
      break;
  }
  if (def?.loadType === 'band') {
    return { kind: 'band', text: 'Move to the next band up, keeping the same rep range.' };
  }
  if (def?.loadType === 'dumbbell' || def?.loadType === 'kettlebell') {
    return {
      kind: 'weight',
      text: 'Add 1-2 reps per set first; once at the top of the range, add a small load.',
    };
  }
  return { kind: 'reps', text: 'Add 1-2 reps per set while keeping the last rep clean.' };
}

/** dayId -> prescriptionId -> prescription, so a result can find its own rules. */
function prescriptionIndex(plan: WorkoutPlan): Map<string, Map<string, ExercisePrescription>> {
  const index = new Map<string, Map<string, ExercisePrescription>>();
  for (const week of plan.weeks) {
    for (const day of week.days) {
      index.set(day.id, new Map(day.prescriptions.map((p) => [p.id, p])));
    }
  }
  return index;
}

function usesDoubleProgression(p: ExercisePrescription | undefined): boolean {
  return p?.progressionType === 'double' || p?.progressionType === 'bandAssist';
}

/** When a session is considered to have happened, for re-raise comparisons. */
function sessionTime(session: WorkoutSession): string {
  return session.completedAt ?? session.startedAt ?? session.date;
}

interface Tally {
  count: number;
  threshold: number;
  lastResult: ExerciseResult;
  /** Time of the most recent qualifying session — drives the re-raise rule. */
  lastQualifiedAt: string;
  verdict: ProgressionVerdict | null;
  repsHigh: number | null;
}

function recommendationForVerdict(verdict: ProgressionVerdict, exerciseId: string): Recommendation {
  if (verdict.kind === 'weight') {
    return {
      kind: 'weight',
      text:
        verdict.suggestedWeight != null
          ? `Increase to ${verdict.suggestedWeight} next session, keeping the same rep range.`
          : 'Add the smallest available load increment next session.',
    };
  }
  if (verdict.kind === 'assistance') {
    return {
      kind: 'assistance',
      text: verdict.suggestedBand
        ? `Move to the ${bandName(verdict.suggestedBand)} band — slightly less assistance.`
        : 'Use slightly less band assistance next session.',
    };
  }
  return recommendationFor(exerciseId);
}

/**
 * Scans session history and returns one pending suggestion per qualifying exercise.
 *
 * With a `plan`, prescriptions marked `double`/`bandAssist` are judged by
 * `evaluateDoubleProgression` and need a single qualifying session; everything else
 * keeps the two-clean-sessions heuristic. Without a plan the old heuristic applies
 * throughout.
 */
export function detectProgressions(
  sessions: WorkoutSession[],
  existing: ProgressionSuggestion[] = [],
  plan?: WorkoutPlan,
): ProgressionSuggestion[] {
  const index = plan ? prescriptionIndex(plan) : null;
  const tallies = new Map<string, Tally>();

  const ordered = [...sessions].sort((a, b) =>
    `${a.date}${a.startedAt}`.localeCompare(`${b.date}${b.startedAt}`),
  );

  for (const session of ordered) {
    if (session.status !== 'completed') continue;
    for (const result of session.results) {
      const prescription = index?.get(session.dayId)?.get(result.prescriptionId);
      let verdict: ProgressionVerdict | null = null;
      if (usesDoubleProgression(prescription)) {
        verdict = evaluateDoubleProgression(prescription as ExercisePrescription, result);
        if (verdict.status !== 'ready') continue;
      } else if (!isSuccessfulResult(result)) {
        continue;
      }
      // Key by the exercise actually performed — a substituted movement must not
      // earn a progression suggestion for the exercise it replaced.
      const id = performedExerciseId(result);
      const prev = tallies.get(id);
      tallies.set(id, {
        count: (prev?.count ?? 0) + 1,
        threshold: verdict ? 1 : (prev?.threshold ?? MIN_SUCCESSFUL_SESSIONS),
        lastResult: result,
        lastQualifiedAt: sessionTime(session),
        verdict,
        repsHigh: prescription?.repsHigh ?? null,
      });
    }
  }

  // A pending suggestion always suppresses a duplicate. An accepted or dismissed one
  // only suppresses sessions up to its own detection — otherwise a user could be told
  // to add weight exactly once per exercise, forever.
  const pending = new Set(existing.filter((s) => s.status === 'pending').map((s) => s.exerciseId));
  const settledAt = new Map<string, string>();
  for (const s of existing) {
    if (s.status === 'pending') continue;
    const current = settledAt.get(s.exerciseId);
    if (current == null || s.detectedAt > current) settledAt.set(s.exerciseId, s.detectedAt);
  }

  const out: ProgressionSuggestion[] = [];
  for (const [exerciseId, tally] of tallies) {
    if (tally.count < tally.threshold) continue;
    if (pending.has(exerciseId)) continue;
    const settled = settledAt.get(exerciseId);
    if (settled != null && !(tally.lastQualifiedAt > settled)) continue;

    const rec = tally.verdict
      ? recommendationForVerdict(tally.verdict, exerciseId)
      : recommendationFor(exerciseId);
    const bestReps = Math.max(0, ...tally.lastResult.sets.map(setReps));
    const ts = nowIso();
    out.push({
      id: newId('sug'),
      createdAt: ts,
      updatedAt: ts,
      schemaVersion: SCHEMA_VERSION,
      exerciseId,
      exerciseName: exerciseName(exerciseId),
      reason: tally.verdict
        ? `Hit the top of the rep range${
            tally.repsHigh ? ` (${tally.repsHigh})` : ''
          } on every working set with good form.`
        : `${tally.count} clean sessions — all sets completed, good form, low pain, RPE 7 or under${
            bestReps ? ` (best set ${bestReps} reps)` : ''
          }.`,
      recommendation: rec.text,
      kind: rec.kind,
      status: 'pending',
      detectedAt: ts,
    });
  }
  return out;
}

/** Suggested starting load from a previous working weight (40-60% of it). */
export function suggestStartWeight(previousWeight: number): number {
  const value = previousWeight * 0.5;
  // Round to the nearest 2.5 to match typical plate/dumbbell increments.
  return Math.max(2.5, Math.round(value / 2.5) * 2.5);
}
