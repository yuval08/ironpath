import { addDays, format, nextMonday, startOfDay } from 'date-fns';
import { db, newId, nowIso, SETTINGS_ID } from './db';
import { migrateAll } from './migrations';
import { buildWeeks, WARM_UP } from '@/data/program';
import { SCHEMA_VERSION } from '@/types';
import type {
  ExerciseResult,
  FinalAssessment,
  PersonalRecord,
  PersonalRecordKind,
  ProgressionSuggestion,
  ResumeChoice,
  SetResult,
  UserSettings,
  WorkoutDay,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';

export const TRAVEL_PAUSE_LABEL = 'Travel';

function base<T extends object>(id: string, extra: T) {
  const ts = nowIso();
  return { id, createdAt: ts, updatedAt: ts, schemaVersion: SCHEMA_VERSION, ...extra };
}

/** Parses a yyyy-MM-dd string as a LOCAL date — `new Date(iso)` would treat it as UTC. */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function defaultStartDate(from = new Date()): string {
  return format(nextMonday(startOfDay(from)), 'yyyy-MM-dd');
}

/**
 * Seeds the four-week plan and default settings on first run.
 *
 * Runs inside a single transaction and re-checks after acquiring it: React 18
 * StrictMode double-invokes the calling effect in dev, and two open tabs race in
 * production. Without this, both callers see an empty table and each writes a
 * plan — leaving a second, permanently invisible plan row behind.
 */
export async function ensureSeeded(): Promise<{ plan: WorkoutPlan; settings: UserSettings }> {
  return db.transaction('rw', db.plans, db.settings, async () => {
    const existingSettings = await db.settings.get(SETTINGS_ID);
    const settings =
      existingSettings ??
      (base(SETTINGS_ID, {
        userName: '',
        weightUnit: 'kg' as const,
        theme: 'system' as const,
        restDefaultSeconds: 60,
        vibrateOnRestEnd: true,
        soundOnRestEnd: false,
        bodyweight: null,
        firstStrictPullUpDate: null,
        disclaimerAcknowledged: false,
        videoOverrides: {},
        weightOverrides: {},
        autoCollapseCompleted: true,
      }) as UserSettings);
    if (!existingSettings) await db.settings.put(settings);

    const existingPlan = await db.plans.toCollection().first();
    if (existingPlan) return { plan: existingPlan, settings };

    const startDate = defaultStartDate();
    const year = new Date(startDate).getFullYear();
    const plan = base(newId('plan'), {
      name: 'Movement & Joint Resilience — 4 Week Block',
      startDate,
      currentWeek: 1,
      currentDayIndex: 0,
      weeks: buildWeeks(),
      pausePeriods: [
        {
          id: newId('pause'),
          label: TRAVEL_PAUSE_LABEL,
          startDate: `${year}-08-10`,
          endDate: `${year}-08-16`,
          active: true,
        },
      ],
      restartCount: 0,
      completedAt: null,
    }) as WorkoutPlan;

    await db.plans.put(plan);
    return { plan, settings };
  });
}

export async function getPlan(): Promise<WorkoutPlan | undefined> {
  const plan = await db.plans.toCollection().first();
  return plan ? migrateAll([plan])[0] : undefined;
}

export async function getSettings(): Promise<UserSettings | undefined> {
  const row = await db.settings.get(SETTINGS_ID);
  return row ? migrateAll([row])[0] : undefined;
}

export async function updateSettings(patch: Partial<UserSettings>): Promise<void> {
  const current = await getSettings();
  if (!current) return;
  await db.settings.put({ ...current, ...patch, updatedAt: nowIso() });
}

export async function updatePlan(patch: Partial<WorkoutPlan>): Promise<void> {
  const plan = await getPlan();
  if (!plan) return;
  await db.plans.put({ ...plan, ...patch, updatedAt: nowIso() });
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

export function currentDay(plan: WorkoutPlan): WorkoutDay | undefined {
  const week = plan.weeks.find((w) => w.weekNumber === plan.currentWeek);
  return week?.days[plan.currentDayIndex];
}

export function isPausedOn(plan: WorkoutPlan, date = new Date()): boolean {
  const day = format(date, 'yyyy-MM-dd');
  return plan.pausePeriods.some((p) => p.active && day >= p.startDate && day <= p.endDate);
}

export function activePause(plan: WorkoutPlan, date = new Date()) {
  const day = format(date, 'yyyy-MM-dd');
  return plan.pausePeriods.find((p) => p.active && day >= p.startDate && day <= p.endDate);
}

/** Projected calendar date for a plan day, skipping any active pause windows. */
export function projectedDate(plan: WorkoutPlan, weekNumber: number, dayIndex: number): string {
  const offsetDays = (weekNumber - 1) * 7 + dayIndex;
  let date = addDays(parseIsoDate(plan.startDate), offsetDays);
  // Push past any pause period the projected date falls inside.
  for (let guard = 0; guard < 60; guard += 1) {
    const iso = format(date, 'yyyy-MM-dd');
    const pause = plan.pausePeriods.find((p) => p.active && iso >= p.startDate && iso <= p.endDate);
    if (!pause) break;
    date = addDays(parseIsoDate(pause.endDate), 1);
  }
  return format(date, 'yyyy-MM-dd');
}

/**
 * Deleting sessions and moving the cursor happen in one transaction — a failure
 * between them would leave history erased but the cursor pointing past it.
 *
 * Session matching is deliberately by `dayId`, not `planId`: the destructive
 * confirmations promise the user that everything logged for those days is gone,
 * and a stray session carrying an older planId would otherwise survive a reset
 * and reappear via findSessionForDay.
 */
export async function applyResumeChoice(choice: ResumeChoice): Promise<void> {
  if (choice === 'resume') return;

  await db.transaction('rw', db.plans, db.sessions, db.suggestions, async () => {
    const plan = await db.plans.toCollection().first();
    if (!plan) return;

    if (choice === 'restartWeek') {
      const weekDayIds = new Set(
        plan.weeks.find((w) => w.weekNumber === plan.currentWeek)?.days.map((d) => d.id) ?? [],
      );
      const sessions = await db.sessions.toArray();
      await db.sessions.bulkDelete(
        sessions.filter((s) => weekDayIds.has(s.dayId)).map((s) => s.id),
      );
      await db.plans.put({ ...plan, currentDayIndex: 0, updatedAt: nowIso() });
      return;
    }

    // restartBlock — wipe all logged history and start over at week 1.
    await db.sessions.clear();
    await db.suggestions.clear();
    await db.plans.put({
      ...plan,
      currentWeek: 1,
      currentDayIndex: 0,
      startDate: defaultStartDate(),
      restartCount: plan.restartCount + 1,
      completedAt: null,
      updatedAt: nowIso(),
    });
  });
}

export async function setPauseActive(pauseId: string, active: boolean): Promise<void> {
  const plan = await getPlan();
  if (!plan) return;
  await updatePlan({
    pausePeriods: plan.pausePeriods.map((p) => (p.id === pauseId ? { ...p, active } : p)),
  });
}

export async function upsertPause(period: {
  id?: string;
  label: string;
  startDate: string;
  endDate: string;
  active: boolean;
}): Promise<void> {
  const plan = await getPlan();
  if (!plan) return;
  const id = period.id ?? newId('pause');
  const exists = plan.pausePeriods.some((p) => p.id === id);
  const next = exists
    ? plan.pausePeriods.map((p) => (p.id === id ? { ...p, ...period, id } : p))
    : [...plan.pausePeriods, { ...period, id }];
  await updatePlan({ pausePeriods: next });
}

export async function removePause(pauseId: string): Promise<void> {
  const plan = await getPlan();
  if (!plan) return;
  await updatePlan({ pausePeriods: plan.pausePeriods.filter((p) => p.id !== pauseId) });
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

function blankSet(setNumber: number): SetResult {
  return {
    setNumber,
    reps: null,
    repsLeft: null,
    repsRight: null,
    weight: null,
    durationSeconds: null,
    distanceMeters: null,
    treadmillMinutes: null,
    treadmillSpeed: null,
    treadmillIncline: null,
    rpe: null,
    rir: null,
    completed: false,
  };
}

export function plannedRepsLabel(p: {
  repsLow?: number;
  repsHigh?: number;
  durationSecondsLow?: number;
  durationSecondsHigh?: number;
  minutes?: number;
  perSide: boolean;
}): string {
  const side = p.perSide ? ' per side' : '';
  if (p.minutes != null) return `${p.minutes} min`;
  if (p.durationSecondsLow != null) {
    const high = p.durationSecondsHigh ?? p.durationSecondsLow;
    return high === p.durationSecondsLow
      ? `${p.durationSecondsLow}s${side}`
      : `${p.durationSecondsLow}-${high}s${side}`;
  }
  if (p.repsLow != null) {
    const high = p.repsHigh ?? p.repsLow;
    return high === p.repsLow ? `${p.repsLow}${side}` : `${p.repsLow}-${high}${side}`;
  }
  return '—';
}

export async function createSession(
  plan: WorkoutPlan,
  day: WorkoutDay,
  weightOverrides: Record<string, number> = {},
): Promise<WorkoutSession> {
  const session = base(newId('session'), {
    planId: plan.id,
    dayId: day.id,
    weekNumber: day.weekNumber,
    weekday: day.weekday,
    dayType: day.dayType,
    date: format(new Date(), 'yyyy-MM-dd'),
    status: 'inProgress' as const,
    startedAt: nowIso(),
    completedAt: null,
    elapsedSeconds: 0,
    warmUp: WARM_UP.map((w) => ({ id: w.id, label: w.label, completed: false })),
    warmUpCompletedAt: null,
    results: day.prescriptions.map<ExerciseResult>((p) => ({
      prescriptionId: p.id,
      exerciseId: p.exerciseId,
      plannedSets: p.sets,
      plannedReps: plannedRepsLabel(p),
      recommendedWeight: weightOverrides[p.exerciseId] ?? p.recommendedWeight ?? null,
      sets: Array.from({ length: p.sets }, (_, i) => ({
        ...blankSet(i + 1),
        weight: weightOverrides[p.exerciseId] ?? p.recommendedWeight ?? null,
        band: p.recommendedBand,
        treadmillMinutes: p.minutes ?? null,
        treadmillSpeed: p.treadmillSpeed ?? null,
        treadmillIncline: p.treadmillIncline ?? null,
      })),
      completed: false,
      notes: '',
      painDuring: null,
      formGood: null,
      substitutionExerciseId: null,
      videoViewed: false,
      skippedReason: null,
      tempo: p.tempo,
    })),
    painBefore: null,
    painAfter: null,
    sessionNotes: '',
    bodyweight: null,
  }) as WorkoutSession;

  await db.sessions.put(session);
  return session;
}

export async function saveSession(session: WorkoutSession): Promise<void> {
  await db.sessions.put({ ...session, updatedAt: nowIso() });
}

export async function getSession(id: string): Promise<WorkoutSession | undefined> {
  const row = await db.sessions.get(id);
  return row ? migrateAll([row])[0] : undefined;
}

export async function getSessions(): Promise<WorkoutSession[]> {
  return migrateAll(await db.sessions.toArray()).sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
}

export async function findInProgressSession(): Promise<WorkoutSession | undefined> {
  const rows = await db.sessions.where('status').equals('inProgress').toArray();
  return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export async function findSessionForDay(dayId: string): Promise<WorkoutSession | undefined> {
  const rows = await db.sessions.where('dayId').equals(dayId).toArray();
  return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

/**
 * Marks the session complete and advances the plan cursor.
 *
 * Two guards, both load-bearing:
 *  - The stored row is re-read first. Finishing takes several async round-trips,
 *    so a second tap on Finish would otherwise re-run this and advance the cursor
 *    twice, silently dropping a training day from the block.
 *  - The cursor only moves when the finished session IS the current day. Any day
 *    of any week can be started from the Plan screen; completing an out-of-order
 *    day must not shift the cursor off a day that was never trained.
 */
export async function completeSession(session: WorkoutSession): Promise<void> {
  const stored = await db.sessions.get(session.id);
  if (stored?.status === 'completed') return;

  await saveSession({ ...session, status: 'completed', completedAt: nowIso() });

  const plan = await getPlan();
  if (!plan) return;
  if (currentDay(plan)?.id !== session.dayId) return;

  const week = plan.weeks.find((w) => w.weekNumber === plan.currentWeek);
  if (!week) return;
  const lastDay = plan.currentDayIndex >= week.days.length - 1;
  if (!lastDay) {
    await updatePlan({ currentDayIndex: plan.currentDayIndex + 1 });
    return;
  }
  if (plan.currentWeek >= 4) {
    await updatePlan({ currentDayIndex: week.days.length - 1, completedAt: nowIso() });
    return;
  }
  await updatePlan({ currentWeek: plan.currentWeek + 1, currentDayIndex: 0 });
}

export async function abandonSession(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  await saveSession({ ...session, status: 'abandoned' });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.sessions.delete(sessionId);
}

/* ------------------------------------------------------------------ */
/* Records & suggestions                                               */
/* ------------------------------------------------------------------ */

export async function recordPR(
  kind: PersonalRecordKind,
  value: number,
  unit: string,
  sessionId: string | null = null,
  notes = '',
): Promise<PersonalRecord | null> {
  const existing = await db.personalRecords.where('kind').equals(kind).toArray();
  const best = existing.reduce<number>((max, r) => Math.max(max, r.value), 0);
  if (value <= best) return null;
  const record = base(newId('pr'), {
    kind,
    value,
    unit,
    date: format(new Date(), 'yyyy-MM-dd'),
    sessionId,
    notes,
  }) as PersonalRecord;
  await db.personalRecords.put(record);
  return record;
}

export async function getPersonalRecords(): Promise<PersonalRecord[]> {
  return migrateAll(await db.personalRecords.toArray());
}

export async function bestRecord(kind: PersonalRecordKind): Promise<PersonalRecord | undefined> {
  const rows = await db.personalRecords.where('kind').equals(kind).toArray();
  return rows.sort((a, b) => b.value - a.value)[0];
}

export async function saveSuggestions(suggestions: ProgressionSuggestion[]): Promise<void> {
  await db.suggestions.bulkPut(suggestions);
}

export async function getSuggestions(): Promise<ProgressionSuggestion[]> {
  return migrateAll(await db.suggestions.toArray());
}

export async function setSuggestionStatus(
  id: string,
  status: ProgressionSuggestion['status'],
): Promise<void> {
  const row = await db.suggestions.get(id);
  if (!row) return;
  await db.suggestions.put({ ...row, status, updatedAt: nowIso() });
}

export async function getAssessment(planId: string): Promise<FinalAssessment | undefined> {
  const rows = await db.assessments.where('planId').equals(planId).toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date))[0];
}

export async function saveAssessment(
  planId: string,
  patch: Partial<FinalAssessment>,
): Promise<FinalAssessment> {
  const existing = await getAssessment(planId);
  const next = existing
    ? { ...existing, ...patch, updatedAt: nowIso() }
    : (base(newId('assessment'), {
        planId,
        date: format(new Date(), 'yyyy-MM-dd'),
        maxStrictPullUps: null,
        maxChinUps: null,
        maxPushUps: null,
        deadHangSeconds: null,
        singleLegBalanceSeconds: null,
        kneeComfort: null,
        shoulderComfort: null,
        lowerBackComfort: null,
        overallEnergy: null,
        favoriteExercises: [],
        painfulExercises: [],
        readyForNextProgram: 'unsure' as const,
        notes: '',
        ...patch,
      }) as FinalAssessment);
  await db.assessments.put(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Destructive helpers                                                 */
/* ------------------------------------------------------------------ */

export async function resetCurrentWorkout(sessionId: string): Promise<void> {
  await db.sessions.delete(sessionId);
}

export async function deleteAllData(): Promise<void> {
  await Promise.all([
    db.plans.clear(),
    db.sessions.clear(),
    db.personalRecords.clear(),
    db.settings.clear(),
    db.suggestions.clear(),
    db.assessments.clear(),
    db.importedWeights.clear(),
    db.meta.clear(),
  ]);
}
