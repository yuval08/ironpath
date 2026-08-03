import { exerciseName, getExercise } from '@/data/exercises';
import { newId, nowIso } from '@/db/db';
import { SCHEMA_VERSION } from '@/types';
import type { ExerciseResult, ProgressionSuggestion, WorkoutSession } from '@/types';
import { setReps } from './stats';

/**
 * Progression is *suggested*, never applied automatically. A suggestion fires when
 * the same exercise clears every gate below in at least two sessions:
 *   - all planned sets completed
 *   - form marked good
 *   - pain during the exercise 0-2 (or not reported)
 *   - every recorded RPE <= 7
 */
export const MIN_SUCCESSFUL_SESSIONS = 2;

export function isSuccessfulResult(result: ExerciseResult): boolean {
  if (result.skippedReason) return false;
  if (!result.completed) return false;
  const allSetsDone =
    result.sets.length >= result.plannedSets && result.sets.every((s) => s.completed);
  if (!allSetsDone) return false;
  if (result.formGood !== true) return false;
  if (result.painDuring != null && result.painDuring > 2) return false;
  const rpes = result.sets.map((s) => s.rpe).filter((v): v is number => typeof v === 'number');
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

/**
 * Scans session history and returns one pending suggestion per qualifying exercise.
 * Existing accepted/dismissed suggestions are preserved and never re-raised.
 */
export function detectProgressions(
  sessions: WorkoutSession[],
  existing: ProgressionSuggestion[] = [],
): ProgressionSuggestion[] {
  const successCount = new Map<string, number>();
  const lastResult = new Map<string, ExerciseResult>();

  for (const session of sessions) {
    if (session.status !== 'completed') continue;
    for (const result of session.results) {
      if (!isSuccessfulResult(result)) continue;
      successCount.set(result.exerciseId, (successCount.get(result.exerciseId) ?? 0) + 1);
      lastResult.set(result.exerciseId, result);
    }
  }

  const handled = new Set(
    existing.filter((s) => s.status !== 'dismissed').map((s) => s.exerciseId),
  );

  const out: ProgressionSuggestion[] = [];
  for (const [exerciseId, count] of successCount) {
    if (count < MIN_SUCCESSFUL_SESSIONS) continue;
    if (handled.has(exerciseId)) continue;
    const rec = recommendationFor(exerciseId);
    const best = lastResult.get(exerciseId);
    const bestReps = best ? Math.max(0, ...best.sets.map(setReps)) : 0;
    const ts = nowIso();
    out.push({
      id: newId('sug'),
      createdAt: ts,
      updatedAt: ts,
      schemaVersion: SCHEMA_VERSION,
      exerciseId,
      exerciseName: exerciseName(exerciseId),
      reason: `${count} clean sessions — all sets completed, good form, low pain, RPE 7 or under${
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
