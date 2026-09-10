import { PUSH_UP_EXERCISE_IDS } from '@/data/programs';
import type {
  ExerciseResult,
  PainEntry,
  PainLevel,
  SetResult,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';

/** Only used when no plan is available — the original 4 weeks x 5 training days. */
export const DEFAULT_TOTAL_SESSIONS = 20;

/** Planned sessions for a plan: every day of every stored week. */
export function totalSessionsFor(plan: WorkoutPlan | null | undefined): number {
  if (!plan) return DEFAULT_TOTAL_SESSIONS;
  return plan.weeks.reduce((sum, week) => sum + week.days.length, 0);
}

/* ------------------------------------------------------------------ */
/* Pain                                                                */
/* ------------------------------------------------------------------ */

export function painLevel(score: number | null | undefined): PainLevel {
  if (score == null) return 'green';
  if (score >= 5) return 'red';
  if (score >= 3) return 'yellow';
  return 'green';
}

export function painNeedsWarning(score: number | null | undefined): boolean {
  return painLevel(score) === 'red';
}

export function averagePain(entries: (PainEntry | null)[], key: keyof PainEntry): number | null {
  const values = entries
    .filter((e): e is PainEntry => e != null)
    .map((e) => e[key])
    .filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Average of both knees across every recorded pain entry in the sessions. */
export function averageKneePain(sessions: WorkoutSession[]): number | null {
  return averageOfPairs(sessions, 'leftKnee', 'rightKnee');
}

export function averageShoulderPain(sessions: WorkoutSession[]): number | null {
  return averageOfPairs(sessions, 'leftShoulder', 'rightShoulder');
}

export function averageBackPain(sessions: WorkoutSession[]): number | null {
  const entries = allPainEntries(sessions);
  return averagePain(entries, 'lowerBack');
}

export function allPainEntries(sessions: WorkoutSession[]): PainEntry[] {
  return sessions.flatMap((s) => [s.painBefore, s.painAfter].filter((p): p is PainEntry => !!p));
}

function averageOfPairs(
  sessions: WorkoutSession[],
  a: keyof PainEntry,
  b: keyof PainEntry,
): number | null {
  const entries = allPainEntries(sessions);
  const values = entries
    .flatMap((e) => [e[a], e[b]])
    .filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  return round1(values.reduce((x, y) => x + y, 0) / values.length);
}

/* ------------------------------------------------------------------ */
/* Volume & completion                                                 */
/* ------------------------------------------------------------------ */

/**
 * What was ACTUALLY performed. `exerciseId` is the planned slot; substituting sets
 * `substitutionExerciseId`. Matching on the slot credits band-assisted reps to
 * strict pull-ups — the substitution this program offers first.
 */
export function performedExerciseId(result: ExerciseResult): string {
  return result.substitutionExerciseId ?? result.exerciseId;
}

/** Skipped exercises never count toward records or totals. */
function counts(result: ExerciseResult, exerciseId: string): boolean {
  return result.skippedReason == null && performedExerciseId(result) === exerciseId;
}

export function completedSessions(sessions: WorkoutSession[]): WorkoutSession[] {
  return sessions.filter((s) => s.status === 'completed');
}

export function completionPercent(
  sessions: WorkoutSession[],
  total = DEFAULT_TOTAL_SESSIONS,
): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completedSessions(sessions).length / total) * 100));
}

/**
 * Ramp sets are logged for context only. Nothing that counts reps, volume or
 * progress may see them, or a heavy single-rep ramp would inflate the numbers.
 */
export function workingSetsOf(result: ExerciseResult): SetResult[] {
  return result.sets.filter((s) => !s.isWarmUp);
}

/** Weight x reps across the completed working sets of one exercise. */
export function exerciseVolume(result: ExerciseResult): number {
  return workingSetsOf(result)
    .filter((s) => s.completed)
    .reduce((sum, set) => sum + (set.weight ?? 0) * setReps(set), 0);
}

/** Total reps logged for one set, counting both sides for per-side entries. */
export function setReps(set: SetResult): number {
  if (set.reps != null) return set.reps;
  const left = set.repsLeft ?? 0;
  const right = set.repsRight ?? 0;
  return left + right;
}

export function exerciseReps(result: ExerciseResult): number {
  return workingSetsOf(result)
    .filter((s) => s.completed)
    .reduce((sum, s) => sum + setReps(s), 0);
}

export function pushUpTotal(sessions: WorkoutSession[]): number {
  return sessions.reduce(
    (sum, session) =>
      sum +
      session.results
        .filter(
          (r) => r.skippedReason == null && PUSH_UP_EXERCISE_IDS.includes(performedExerciseId(r)),
        )
        .reduce((s, r) => s + exerciseReps(r), 0),
    0,
  );
}

export function pushUpBreakdown(sessions: WorkoutSession[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of PUSH_UP_EXERCISE_IDS) out[id] = 0;
  for (const session of sessions) {
    for (const result of session.results) {
      const id = performedExerciseId(result);
      if (result.skippedReason == null && PUSH_UP_EXERCISE_IDS.includes(id)) {
        out[id] = (out[id] ?? 0) + exerciseReps(result);
      }
    }
  }
  return out;
}

export function pushUpTotalForWeek(sessions: WorkoutSession[], weekNumber: number): number {
  return pushUpTotal(sessions.filter((s) => s.weekNumber === weekNumber));
}

/** Best single-set rep count for an exercise across all sessions. */
export function maxRepsForExercise(sessions: WorkoutSession[], exerciseId: string): number {
  let max = 0;
  for (const session of sessions) {
    for (const result of session.results) {
      if (!counts(result, exerciseId)) continue;
      for (const set of workingSetsOf(result)) {
        if (!set.completed) continue;
        max = Math.max(max, setReps(set));
      }
    }
  }
  return max;
}

export function totalRepsForExercise(sessions: WorkoutSession[], exerciseId: string): number {
  return sessions.reduce(
    (sum, session) =>
      sum +
      session.results.filter((r) => counts(r, exerciseId)).reduce((s, r) => s + exerciseReps(r), 0),
    0,
  );
}

export function maxDurationForExercise(sessions: WorkoutSession[], exerciseId: string): number {
  let max = 0;
  for (const session of sessions) {
    for (const result of session.results) {
      if (!counts(result, exerciseId)) continue;
      for (const set of workingSetsOf(result)) {
        if (!set.completed) continue;
        max = Math.max(max, set.durationSeconds ?? 0);
      }
    }
  }
  return max;
}

export function maxTreadmillMinutes(sessions: WorkoutSession[], exerciseId: string): number {
  let max = 0;
  for (const session of sessions) {
    for (const result of session.results) {
      if (!counts(result, exerciseId)) continue;
      for (const set of workingSetsOf(result)) {
        if (!set.completed) continue;
        max = Math.max(max, set.treadmillMinutes ?? 0);
      }
    }
  }
  return max;
}

export function maxTreadmillSpeed(sessions: WorkoutSession[], exerciseId: string): number {
  let max = 0;
  for (const session of sessions) {
    for (const result of session.results) {
      if (!counts(result, exerciseId)) continue;
      for (const set of workingSetsOf(result)) {
        max = Math.max(max, set.treadmillSpeed ?? 0);
      }
    }
  }
  return max;
}

export function averageRpe(session: WorkoutSession): number | null {
  const values = session.results
    .flatMap(workingSetsOf)
    .map((s) => s.rpe)
    .filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Sum of weight x reps across completed sets — a rough weekly tonnage figure. */
export function sessionVolume(session: WorkoutSession): number {
  return session.results.reduce((sum, result) => sum + exerciseVolume(result), 0);
}

export function weeklyVolume(sessions: WorkoutSession[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const session of completedSessions(sessions)) {
    out[session.weekNumber] = (out[session.weekNumber] ?? 0) + sessionVolume(session);
  }
  return out;
}

export function sessionProgress(session: WorkoutSession): number {
  const relevant = session.results.filter((r) => r.skippedReason == null);
  if (relevant.length === 0) return 0;
  const done = relevant.filter((r) => r.completed).length;
  return Math.round((done / relevant.length) * 100);
}

/* ------------------------------------------------------------------ */
/* Trends                                                              */
/* ------------------------------------------------------------------ */

export interface TrendPoint {
  date: string;
  value: number;
}

function byDate(sessions: WorkoutSession[]): WorkoutSession[] {
  return [...sessions].sort((a, b) =>
    `${a.date}${a.startedAt}`.localeCompare(`${b.date}${b.startedAt}`),
  );
}

/** Mean RIR per completed session. Sessions with no RIR logged are left out. */
export function rirTrend(sessions: WorkoutSession[]): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (const session of byDate(completedSessions(sessions))) {
    const values = session.results
      .flatMap(workingSetsOf)
      .map((s) => s.rir)
      .filter((v): v is number => typeof v === 'number');
    if (values.length === 0) continue;
    out.push({
      date: session.date,
      value: round1(values.reduce((a, b) => a + b, 0) / values.length),
    });
  }
  return out;
}

/** Active workout minutes per completed session, against the 45-55 min target. */
export function durationTrend(sessions: WorkoutSession[]): TrendPoint[] {
  return byDate(completedSessions(sessions))
    .filter((s) => s.elapsedSeconds > 0)
    .map((s) => ({ date: s.date, value: round1(s.elapsedSeconds / 60) }));
}

/**
 * Rolling mean bodyweight over a trailing window ending at each weigh-in, which
 * smooths the day-to-day water swings that make raw readings unreadable.
 */
export function bodyweightRollingAverage(sessions: WorkoutSession[], days = 7): TrendPoint[] {
  const points = byDate(sessions)
    .filter((s) => typeof s.bodyweight === 'number')
    .map((s) => ({ date: s.date, weight: s.bodyweight as number }));
  const windowMs = days * 24 * 60 * 60 * 1000;
  return points.map((point, i) => {
    const end = Date.parse(point.date);
    const inWindow = points
      .slice(0, i + 1)
      .filter((p) => end - Date.parse(p.date) < windowMs)
      .map((p) => p.weight);
    return {
      date: point.date,
      value: round1(inWindow.reduce((a, b) => a + b, 0) / inWindow.length),
    };
  });
}

export function planProgressLabel(plan: WorkoutPlan): string {
  return `Week ${plan.currentWeek} · Day ${plan.currentDayIndex + 1}`;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function kgToLb(kg: number): number {
  return round1(kg * 2.2046226218);
}

export function lbToKg(lb: number): number {
  return round1(lb / 2.2046226218);
}

export function convertWeight(value: number, from: 'kg' | 'lb', to: 'kg' | 'lb'): number {
  if (from === to) return round1(value);
  return from === 'kg' ? kgToLb(value) : lbToKg(value);
}
