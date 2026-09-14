import { fingerprint } from '@/utils/fingerprint';
import type { ProgramId, WeightUnit, WorkoutPlan } from '@/types';
import type { ProgramDefinition } from './index';

/**
 * Keeping a stored plan in step with its program file.
 *
 * A plan copies its weeks out of the program when it is created, so editing the
 * program JSON changes nothing for a plan that already exists on a device. This
 * module decides when the new build can replace the stored one.
 *
 * The only thing that can be lost by replacing `weeks` is an in-app edit made on
 * the Plan screen — logged sessions live in their own table and keep their
 * prescription ids, which are stable across rebuilds. So the rule is: replace
 * silently when the stored weeks are still exactly what a program build produced,
 * and ask first when they are not.
 */

/**
 * Fingerprints of every build a device can already be holding from before plans
 * recorded their own. Taken from the two commits that shipped the hypertrophy
 * program: 73cd8f01 is the kg-step build (9abc52f, and b3a8652 in kg), 7008e799
 * the lb build (b3a8652). A plan whose weeks match one of these is unedited.
 */
export const LEGACY_BUILD_FINGERPRINTS: Partial<Record<ProgramId, readonly string[]>> = {
  'hypertrophy-14wk': ['73cd8f01', '7008e799'],
};

export type PlanUpdateStatus =
  /** Stored weeks already match the current program. */
  | 'current'
  /** The program changed and the plan was never edited: safe to apply automatically. */
  | 'safe'
  /** The program changed but the plan has in-app edits that applying would replace. */
  | 'edited'
  /** The program is not maintained as data, so stored plans are left alone. */
  | 'unsupported';

export function planUpdateStatus(
  plan: WorkoutPlan,
  program: ProgramDefinition,
  weightUnit: WeightUnit,
  legacy: readonly string[] = LEGACY_BUILD_FINGERPRINTS[plan.programId] ?? [],
): PlanUpdateStatus {
  if (!program.syncStoredPlans) return 'unsupported';
  const built = fingerprint(program.buildWeeks({ weightUnit }));
  const stored = fingerprint(plan.weeks);
  if (stored === built) return 'current';
  if (plan.builtFingerprint != null) {
    // Built from this exact program: whatever differs is the user's own edit, and
    // there is nothing new to offer. Without this, every in-app edit would announce
    // an update that does not exist.
    if (plan.builtFingerprint === built) return 'current';
    return stored === plan.builtFingerprint ? 'safe' : 'edited';
  }
  return legacy.includes(stored) ? 'safe' : 'edited';
}

/**
 * The patch that moves a plan onto the current program build. The cursor is
 * clamped rather than reset: a program that drops a week or a day must not leave
 * the plan pointing past the end, but one that only changes exercises must not
 * send the user back to week 1 either.
 */
export function rebuiltPlanPatch(
  plan: WorkoutPlan,
  program: ProgramDefinition,
  weightUnit: WeightUnit,
): Pick<WorkoutPlan, 'weeks' | 'builtFingerprint' | 'currentWeek' | 'currentDayIndex'> {
  const weeks = program.buildWeeks({ weightUnit });
  const currentWeek = Math.min(Math.max(plan.currentWeek, 1), weeks.length);
  const days = weeks.find((w) => w.weekNumber === currentWeek)?.days.length ?? 1;
  return {
    weeks,
    builtFingerprint: fingerprint(weeks),
    currentWeek,
    currentDayIndex: Math.min(plan.currentDayIndex, Math.max(days - 1, 0)),
  };
}
