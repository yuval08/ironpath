import { exerciseName } from '@/data/exercises';
import { bandName, setHint } from './doubleProgression';
import type { BandLabels } from './doubleProgression';
import { performedExerciseId } from './stats';
import { prescriptionGroups } from './workoutExecution';
import type { ExerciseResult, WorkoutDay, WorkoutSession } from '@/types';

/** What to get ready for while resting. */
export interface NextUp {
  /** 'set' continues an exercise already started; 'exercise' moves to a new one. */
  kind: 'set' | 'exercise';
  /** "A2 · Bench press" */
  title: string;
  /** "Set 3 of 4 · 8-12 reps · 60 kg" */
  detail: string;
}

const owes = (result: ExerciseResult) =>
  !result.skippedReason && result.sets.some((s) => !s.isWarmUp && !s.completed);

const doneCount = (result: ExerciseResult) =>
  result.sets.filter((s) => !s.isWarmUp && s.completed).length;

/** "8-12" reads as a rep range only with its unit; durations already carry one. */
function targetLabel(planned: string): string {
  return planned.replace(/^(\d+(?:-\d+)?)( per side)?$/, '$1 reps$2');
}

/**
 * The next working set in program order. Inside a superset the member with the
 * fewest completed sets goes next, which walks A1 -> A2 -> A1 and lets the longer
 * member of an uneven pairing finish alone.
 */
export function nextUp(
  day: WorkoutDay | undefined,
  session: WorkoutSession,
  previousFor: (exerciseId: string) => ExerciseResult | null,
  weightUnit: string,
  bandLabels?: BandLabels,
): NextUp | null {
  if (!day) return null;
  for (const group of prescriptionGroups(day)) {
    const candidates = group.flatMap((prescription) => {
      const result = session.results.find((r) => r.prescriptionId === prescription.id);
      return result && owes(result) ? [{ prescription, result }] : [];
    });
    if (!candidates.length) continue;
    const { prescription, result } = candidates.reduce((best, c) =>
      doneCount(c.result) < doneCount(best.result) ? c : best,
    );
    const working = result.sets.filter((s) => !s.isWarmUp);
    const index = working.findIndex((s) => !s.completed);
    const set = working[index]!;
    const exerciseId = performedExerciseId(result);
    const hint = setHint(previousFor(exerciseId), index);
    const weight = set.weight ?? hint?.weight ?? result.recommendedWeight;
    const band = set.band ?? hint?.band ?? prescription.recommendedBand;
    const load =
      weight != null
        ? `${weight} ${weightUnit}`
        : band != null && band !== 'none'
          ? `${bandName(band, bandLabels)} band`
          : null;
    const name = exerciseName(exerciseId);
    return {
      kind: doneCount(result) > 0 ? 'set' : 'exercise',
      title: prescription.slot ? `${prescription.slot} · ${name}` : name,
      detail: [`Set ${index + 1} of ${working.length}`, targetLabel(result.plannedReps), load]
        .filter(Boolean)
        .join(' · '),
    };
  }
  return null;
}

/** One line for notifications: "Next set: Bench press · Set 3 of 4 · 8-12 reps". */
export function nextUpLine(next: NextUp | null | undefined): string | null {
  if (!next) return null;
  return `${next.kind === 'set' ? 'Next set' : 'Next exercise'}: ${next.title} · ${next.detail}`;
}
