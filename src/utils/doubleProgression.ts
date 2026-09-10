import { DEFAULT_BAND_LABELS } from '@/types';
import type {
  BandResistance,
  ExercisePrescription,
  ExerciseResult,
  SetResult,
  WorkoutSession,
} from '@/types';
import { performedExerciseId } from './stats';

/** Descending assistance: the first entry helps the most, the last none at all. */
export const BAND_LADDER: BandResistance[] = [
  'extraHeavy',
  'heavy',
  'medium',
  'light',
  'extraLight',
  'none',
];

export function nextLighterBand(b: BandResistance): BandResistance | null {
  const i = BAND_LADDER.indexOf(b);
  if (i < 0 || i >= BAND_LADDER.length - 1) return null;
  return BAND_LADDER[i + 1] ?? null;
}

/** Ramp sets are logged for context only — they never count toward anything. */
export function workingSets(result: ExerciseResult): SetResult[] {
  return result.sets.filter((s) => !s.isWarmUp);
}

export function rampSetsOf(result: ExerciseResult): SetResult[] {
  return result.sets.filter((s) => s.isWarmUp);
}

/**
 * Reps a set is *worth* for progression. A per-side set is only as good as its
 * weaker side, so it counts as the minimum — unlike `setReps` in stats.ts, which
 * sums both sides because it is measuring total work done.
 */
export function progressionReps(set: SetResult): number {
  if (set.repsLeft != null || set.repsRight != null) {
    return Math.min(set.repsLeft ?? 0, set.repsRight ?? 0);
  }
  return set.reps ?? 0;
}

export interface PerformanceSnapshot {
  date: string;
  weight: number | null;
  band: BandResistance | null;
  reps: number[];
  rir: (number | null)[];
}

export function snapshotFor(session: WorkoutSession, result: ExerciseResult): PerformanceSnapshot {
  const sets = workingSets(result);
  const weights = sets.map((s) => s.weight).filter((w): w is number => typeof w === 'number');
  const bands = sets.map((s) => s.band).filter((b): b is BandResistance => b != null);
  return {
    date: session.date,
    weight: weights.length ? Math.max(...weights) : null,
    band: bands[bands.length - 1] ?? null,
    reps: sets.map(progressionReps),
    rir: sets.map((s) => s.rir ?? null),
  };
}

function resultsFor(session: WorkoutSession, exerciseId: string): ExerciseResult[] {
  return session.results.filter(
    (r) => r.skippedReason == null && performedExerciseId(r) === exerciseId,
  );
}

function sortedByDate(sessions: WorkoutSession[]): WorkoutSession[] {
  return [...sessions].sort((a, b) =>
    `${a.date}${a.startedAt}`.localeCompare(`${b.date}${b.startedAt}`),
  );
}

/** Every logged performance of an exercise, oldest first. */
export function performanceHistory(
  sessions: WorkoutSession[],
  exerciseId: string,
): PerformanceSnapshot[] {
  const out: PerformanceSnapshot[] = [];
  for (const session of sortedByDate(sessions)) {
    if (session.status === 'abandoned') continue;
    for (const result of resultsFor(session, exerciseId)) {
      const snap = snapshotFor(session, result);
      if (snap.reps.length === 0 && snap.weight == null && snap.band == null) continue;
      out.push(snap);
    }
  }
  return out;
}

export function lastPerformance(
  sessions: WorkoutSession[],
  exerciseId: string,
): PerformanceSnapshot | null {
  const history = performanceHistory(sessions, exerciseId);
  return history[history.length - 1] ?? null;
}

/**
 * Band labels are PARTIAL by design. Band resistance varies by manufacturer, so the
 * user renames the bands they actually own — requiring all six before any of them
 * work would be hostile. A missing key is a normal state, not an error: every band
 * falls back to its default label. Do not tighten this to a full Record.
 */
export type BandLabels = Partial<Record<BandResistance, string>>;

function bandLabel(band: BandResistance, labels?: BandLabels): string {
  return labels?.[band] || SHORT_BAND_LABELS[band];
}

/** Short forms for the history line; `settings.bandLabels` overrides them when passed. */
const SHORT_BAND_LABELS: Record<BandResistance, string> = {
  extraHeavy: 'Extra heavy',
  heavy: 'Heavy',
  medium: 'Medium',
  light: 'Light',
  extraLight: 'Extra light',
  none: 'No band',
};

export function formatPerformance(
  s: PerformanceSnapshot | null,
  unit: string,
  bandLabels?: BandLabels,
): string {
  if (!s) return 'No history yet';
  const parts: string[] = [];
  if (s.weight != null) {
    parts.push(`${s.weight} ${unit}`);
  } else if (s.band != null) {
    parts.push(s.band === 'none' ? 'Bodyweight' : `${bandLabel(s.band, bandLabels)} band`);
  }
  if (s.reps.length) parts.push(s.reps.join(' / '));
  if (s.rir.some((v) => v != null)) {
    parts.push(`RIR ${s.rir.map((v) => (v == null ? '–' : v)).join(' / ')}`);
  }
  return parts.length ? parts.join(' · ') : 'No history yet';
}

export type ProgressionStatus = 'ready' | 'hold' | 'noData';

export interface ProgressionVerdict {
  status: ProgressionStatus;
  kind: 'weight' | 'assistance' | 'reps' | 'none';
  /** 'Ready to increase load next session' | 'Ready to reduce band assistance' */
  message: string;
  suggestedWeight: number | null;
  suggestedBand: BandResistance | null;
}

const NO_DATA: ProgressionVerdict = {
  status: 'noData',
  kind: 'none',
  message: 'No history yet',
  suggestedWeight: null,
  suggestedBand: null,
};

function hold(kind: ProgressionVerdict['kind'], message: string): ProgressionVerdict {
  return { status: 'hold', kind, message, suggestedWeight: null, suggestedBand: null };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function averageRir(sets: SetResult[]): number | null {
  const values = sets.map((s) => s.rir).filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * RIR intentionally does NOT gate readiness. Hitting the top of the rep range with
 * 3 reps in reserve is a *stronger* case for adding load than scraping it at RIR 0,
 * so gating on "RIR must be low" would hold back exactly the sessions that earned
 * the increase. RIR only colours the wording below. Do not "fix" this backwards.
 */
function rirColour(sets: SetResult[], prescription: ExercisePrescription): string {
  const avg = averageRir(sets);
  if (avg == null) return '';
  const { targetRirHigh, targetRirLow } = prescription;
  if (targetRirHigh != null && avg > targetRirHigh) {
    return ' — RIR was above target, the load is clearly light';
  }
  if (targetRirLow != null && avg < targetRirLow) {
    return ' — RIR was low, take the smallest step up';
  }
  return '';
}

export function evaluateDoubleProgression(
  prescription: ExercisePrescription,
  result: ExerciseResult | null | undefined,
): ProgressionVerdict {
  const type = prescription.progressionType;
  if (type !== 'double' && type !== 'bandAssist') return NO_DATA;
  const kind: ProgressionVerdict['kind'] = type === 'double' ? 'weight' : 'assistance';

  if (!result) return { ...NO_DATA, kind };
  const repsHigh = prescription.repsHigh;
  if (repsHigh == null) return { ...NO_DATA, kind };

  // 1. the exercise was actually performed, with acceptable form
  if (result.skippedReason != null) return hold(kind, 'Skipped last session — repeat it first');
  if (result.formGood === false) return hold(kind, 'Form broke down — repeat the same load');

  // 2. every planned working set was completed
  const sets = workingSets(result);
  if (sets.length === 0) return { ...NO_DATA, kind };
  if (sets.length < prescription.sets || !sets.every((s) => s.completed)) {
    return hold(kind, `Complete all ${prescription.sets} working sets to progress`);
  }

  // 3. every working set reached the top of the rep range
  if (!sets.every((s) => progressionReps(s) >= repsHigh)) {
    return hold(kind, `Hit ${repsHigh} reps on every working set to progress`);
  }

  const colour = rirColour(sets, prescription);

  if (type === 'double') {
    const weights = sets.map((s) => s.weight).filter((w): w is number => typeof w === 'number');
    const current = weights.length ? Math.max(...weights) : null;
    const increment = prescription.weightIncrement;
    return {
      status: 'ready',
      kind: 'weight',
      message: `Ready to increase load next session${colour}`,
      suggestedWeight: current != null && increment != null ? round1(current + increment) : null,
      suggestedBand: null,
    };
  }

  const bands = sets.map((s) => s.band).filter((b): b is BandResistance => b != null);
  const currentBand = bands.length
    ? bands[bands.length - 1]
    : (prescription.recommendedBand ?? null);
  const lighter = currentBand ? nextLighterBand(currentBand) : null;
  if (!lighter) {
    // Already unassisted — there is no band left to drop, so the progression is reps.
    return {
      status: 'ready',
      kind: 'reps',
      message: `Ready to progress — no lighter band left, add reps or a set${colour}`,
      suggestedWeight: null,
      suggestedBand: null,
    };
  }
  return {
    status: 'ready',
    kind: 'assistance',
    message: `Ready to reduce band assistance${colour}`,
    suggestedWeight: null,
    suggestedBand: lighter,
  };
}

/** Human label for a band, honouring the user's own naming when supplied. */
export function bandName(band: BandResistance, labels: BandLabels = DEFAULT_BAND_LABELS): string {
  return labels[band] || DEFAULT_BAND_LABELS[band];
}
