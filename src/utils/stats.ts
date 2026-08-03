import { PUSH_UP_EXERCISE_IDS } from '@/data/program';
import type {
  ExerciseResult,
  PainEntry,
  PainLevel,
  SetResult,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';

export const TOTAL_SESSIONS = 20; // 4 weeks x 5 training days

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

export function completedSessions(sessions: WorkoutSession[]): WorkoutSession[] {
  return sessions.filter((s) => s.status === 'completed');
}

export function completionPercent(sessions: WorkoutSession[], total = TOTAL_SESSIONS): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completedSessions(sessions).length / total) * 100));
}

/** Total reps logged for one set, counting both sides for per-side entries. */
export function setReps(set: SetResult): number {
  if (set.reps != null) return set.reps;
  const left = set.repsLeft ?? 0;
  const right = set.repsRight ?? 0;
  return left + right;
}

export function exerciseReps(result: ExerciseResult): number {
  return result.sets.filter((s) => s.completed).reduce((sum, s) => sum + setReps(s), 0);
}

export function pushUpTotal(sessions: WorkoutSession[]): number {
  return sessions.reduce(
    (sum, session) =>
      sum +
      session.results
        .filter((r) => PUSH_UP_EXERCISE_IDS.includes(r.exerciseId))
        .reduce((s, r) => s + exerciseReps(r), 0),
    0,
  );
}

export function pushUpBreakdown(sessions: WorkoutSession[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of PUSH_UP_EXERCISE_IDS) out[id] = 0;
  for (const session of sessions) {
    for (const result of session.results) {
      if (PUSH_UP_EXERCISE_IDS.includes(result.exerciseId)) {
        out[result.exerciseId] = (out[result.exerciseId] ?? 0) + exerciseReps(result);
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
      if (result.exerciseId !== exerciseId) continue;
      for (const set of result.sets) {
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
      session.results
        .filter((r) => r.exerciseId === exerciseId)
        .reduce((s, r) => s + exerciseReps(r), 0),
    0,
  );
}

export function maxDurationForExercise(sessions: WorkoutSession[], exerciseId: string): number {
  let max = 0;
  for (const session of sessions) {
    for (const result of session.results) {
      if (result.exerciseId !== exerciseId) continue;
      for (const set of result.sets) {
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
      if (result.exerciseId !== exerciseId) continue;
      for (const set of result.sets) {
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
      if (result.exerciseId !== exerciseId) continue;
      for (const set of result.sets) {
        max = Math.max(max, set.treadmillSpeed ?? 0);
      }
    }
  }
  return max;
}

export function averageRpe(session: WorkoutSession): number | null {
  const values = session.results
    .flatMap((r) => r.sets)
    .map((s) => s.rpe)
    .filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Sum of weight x reps across completed sets — a rough weekly tonnage figure. */
export function sessionVolume(session: WorkoutSession): number {
  return session.results.reduce(
    (sum, result) =>
      sum +
      result.sets
        .filter((s) => s.completed)
        .reduce((s, set) => s + (set.weight ?? 0) * setReps(set), 0),
    0,
  );
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
