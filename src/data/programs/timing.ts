import type { ExercisePrescription } from '@/types';

/**
 * Session-length estimation, shared by every program so one change to the
 * model moves both plans at once. A program that estimates its own length
 * differently from its neighbour is a program whose 45-55 min promise is
 * unverifiable.
 */

export interface WarmUpItem {
  id: string;
  label: string;
  exerciseId?: string;
}

/**
 * Pacing defaults. These match the Movement & Joint Resilience block, whose
 * work is mobility, bodyweight and light band drills done at a brisk clip.
 */
const DEFAULT_SECONDS_PER_REP = 3;
/** Walking to the rack, setting a band, changing the treadmill direction. */
const DEFAULT_TRANSITION_SECONDS = 30;
/**
 * Moving between the stations of a superset, every round. Defaults to 0 so the
 * resilience block's long-standing estimates do not shift under it; the
 * hypertrophy program opts in, where the two stations are real machines across
 * a gym floor rather than a mat and a band.
 */
const DEFAULT_INTRA_SUPERSET_SECONDS = 0;
/** A ramp set is one light set with almost no time under tension, plus the plate change. */
const SECONDS_PER_RAMP_SET = 25;

/**
 * Per-program pacing. A program that trains differently takes a different
 * amount of time per rep, and the estimate is DISPLAYED to the user as the
 * session target — so an inherited constant is not a harmless default, it is a
 * wrong number on the workout screen.
 *
 * Do not unify `secondsPerRep` across the programs. Hypertrophy sets are loaded
 * and run a controlled eccentric (roughly 4 s/rep); resilience work is
 * bodyweight and mobility at roughly 3 s/rep. Collapsing the two would make one
 * program's target dishonest, and an under-estimate is the dangerous direction:
 * it makes sessions look like they have room they do not have.
 */
export interface TimingOptions {
  secondsPerRep?: number;
  transitionSeconds?: number;
  intraSupersetSeconds?: number;
}

function workSeconds(p: ExercisePrescription, secondsPerRep: number): number {
  const sides = p.perSide ? 2 : 1;
  if (p.minutes != null) return p.minutes * 60;
  if (p.durationSecondsHigh != null) return p.durationSecondsHigh * sides;
  if (p.entryStyle === 'stepsPerDirection') return (p.repsHigh ?? 12) * 1.5 * 2;
  if (p.repsHigh != null) return p.repsHigh * secondsPerRep * sides;
  return 30;
}

/**
 * Two prescriptions belong to the same performed unit when they are explicitly
 * paired (`supersetKey`) or, for the older block-labelled program, when they
 * carry the same `blockLabel`. `supersetKey` wins wherever it is present so a
 * program can put two different supersets under one visual block heading.
 */
function chainable(a: ExercisePrescription, b: ExercisePrescription): boolean {
  if (a.supersetKey != null || b.supersetKey != null) return a.supersetKey === b.supersetKey;
  return a.blockLabel === b.blockLabel;
}

/**
 * Splits a day into the units actually performed back-to-back: a run of
 * prescriptions chained by `restSeconds: 0` inside one block. Rest only happens
 * at the end of a superset, so grouping drives the whole time estimate.
 */
export function supersetGroups(prescriptions: ExercisePrescription[]): ExercisePrescription[][] {
  const groups: ExercisePrescription[][] = [];
  let current: ExercisePrescription[] = [];
  for (const p of prescriptions) {
    const previous = current[current.length - 1];
    if (previous && !chainable(previous, p)) {
      groups.push(current);
      current = [];
    }
    current.push(p);
    if (p.restSeconds > 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Estimated session length at the TOP of every rep range — the worst case.
 * Excludes the warm-up, which is tracked separately (and for the hypertrophy
 * program happens outside the app entirely).
 *
 * Ramp sets are charged once per group, not once per round: you ramp into the
 * first working set and never again. Moving between superset stations IS
 * charged per round, because you really do walk it every round.
 */
export function estimateSessionMinutes(
  prescriptions: ExercisePrescription[],
  options: TimingOptions = {},
): number {
  const {
    secondsPerRep = DEFAULT_SECONDS_PER_REP,
    transitionSeconds = DEFAULT_TRANSITION_SECONDS,
    intraSupersetSeconds = DEFAULT_INTRA_SUPERSET_SECONDS,
  } = options;

  let seconds = 0;
  for (const group of supersetGroups(prescriptions)) {
    const rounds = Math.max(...group.map((p) => p.sets));
    const perRound = group.reduce((sum, p) => sum + workSeconds(p, secondsPerRep), 0);
    const rest = group.reduce((sum, p) => sum + p.restSeconds, 0);
    const ramp = group.reduce((sum, p) => sum + (p.rampSets ?? 0) * SECONDS_PER_RAMP_SET, 0);
    const walk = (group.length - 1) * intraSupersetSeconds;
    seconds += rounds * (perRound + rest + walk) + transitionSeconds * group.length + ramp;
  }
  return Math.round(seconds / 60);
}
