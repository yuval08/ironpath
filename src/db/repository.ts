import { addDays, format, nextMonday, startOfDay } from 'date-fns';
import { db, newId, nowIso, SETTINGS_ID } from './db';
import { migrateAll } from './migrations';
import { DEFAULT_PROGRAM_ID, programFor } from '@/data/programs';
// Single source of truth lives in @/utils/stats (pure, tested there). Re-exported
// here because spec §8 has the screens import it alongside the plan API; the
// dependency only runs repository -> stats, so there is no cycle.
export { totalSessionsFor } from '@/utils/stats';
import { DEFAULT_BAND_LABELS, SCHEMA_VERSION } from '@/types';
import type {
  ExerciseResult,
  FinalAssessment,
  PersonalRecord,
  PersonalRecordKind,
  ProgramId,
  ProgressionSuggestion,
  ResumeChoice,
  SetResult,
  UserSettings,
  WorkoutDay,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';

export const TRAVEL_PAUSE_LABEL = 'Travel';

/**
 * Set once the Ironpath hypertrophy plan has been added to an existing install.
 * Without it, a user who deliberately deletes that plan would have it recreated
 * on the next launch, forever.
 */
export const IRONPATH_SEED_META_KEY = 'ironpathPlanSeeded';

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

function defaultSettings(): UserSettings {
  return base(SETTINGS_ID, {
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
    activePlanId: null,
    bandLabels: DEFAULT_BAND_LABELS,
  }) as UserSettings;
}

/** Builds (and stores) a fresh plan from a program definition. */
export async function createPlanFromProgram(
  programId: ProgramId,
  startDate = defaultStartDate(),
): Promise<WorkoutPlan> {
  const program = programFor(programId);
  const year = parseIsoDate(startDate).getFullYear();
  const plan = base(newId('plan'), {
    name: program.name,
    startDate,
    currentWeek: 1,
    currentDayIndex: 0,
    weeks: program.buildWeeks(),
    // The travel window is part of the resilience block's own history; a plan
    // started from any other program begins with a clean calendar.
    pausePeriods:
      programId === 'movement-resilience'
        ? [
            {
              id: newId('pause'),
              label: TRAVEL_PAUSE_LABEL,
              startDate: `${year}-08-10`,
              endDate: `${year}-08-16`,
              active: true,
            },
          ]
        : [],
    restartCount: 0,
    completedAt: null,
    programId,
    archived: false,
  }) as WorkoutPlan;
  await db.plans.put(plan);
  return plan;
}

/** activePlanId → first non-archived plan → first plan. */
function resolveActivePlan(
  plans: WorkoutPlan[],
  settings: UserSettings | undefined,
): WorkoutPlan | undefined {
  const pinned = settings?.activePlanId
    ? plans.find((p) => p.id === settings.activePlanId)
    : undefined;
  return pinned ?? plans.find((p) => !p.archived) ?? plans[0];
}

/**
 * Seeds default settings and the default program's plan on first run, and adds
 * the Ironpath hypertrophy plan once to installs that predate it.
 *
 * Runs inside a single transaction and re-checks after acquiring it: React 18
 * StrictMode double-invokes the calling effect in dev, and two open tabs race in
 * production. Without this, both callers see an empty table and each writes a
 * plan — leaving a second, permanently invisible plan row behind. The same race
 * would double-add the hypertrophy plan, which is why the `ironpathPlanSeeded`
 * meta key is written inside the transaction too.
 */
export async function ensureSeeded(): Promise<{ plan: WorkoutPlan; settings: UserSettings }> {
  return db.transaction('rw', db.plans, db.settings, db.meta, async () => {
    const existingSettings = await db.settings.get(SETTINGS_ID);
    let settings = existingSettings ? migrateAll([existingSettings])[0]! : defaultSettings();
    // A v1 settings row has no activePlanId/bandLabels; persist the upgrade now so
    // every later reader sees the same shape.
    if (!existingSettings || existingSettings.schemaVersion !== settings.schemaVersion) {
      await db.settings.put(settings);
    }

    const setActive = async (plan: WorkoutPlan) => {
      settings = { ...settings, activePlanId: plan.id, updatedAt: nowIso() };
      await db.settings.put(settings);
      return { plan, settings };
    };

    const plans = migrateAll(await db.plans.toArray());
    if (plans.length === 0) {
      return setActive(await createPlanFromProgram(DEFAULT_PROGRAM_ID));
    }

    const alreadySeeded = (await db.meta.get(IRONPATH_SEED_META_KEY)) != null;
    const hasHypertrophy = plans.some((p) => p.programId === 'hypertrophy-14wk');
    if (!alreadySeeded && !hasHypertrophy) {
      // Non-destructive: the existing plan and every session it owns stay exactly
      // where they are — the new plan is simply added alongside and made active.
      const plan = await createPlanFromProgram('hypertrophy-14wk');
      await db.meta.put({ key: IRONPATH_SEED_META_KEY, value: nowIso() });
      return setActive(plan);
    }

    return { plan: resolveActivePlan(plans, settings)!, settings };
  });
}

export async function getPlans(): Promise<WorkoutPlan[]> {
  return migrateAll(await db.plans.toArray()).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

/** The plan the user is currently training. */
export async function getPlan(): Promise<WorkoutPlan | undefined> {
  const [plans, settings] = await Promise.all([getPlans(), getSettings()]);
  return resolveActivePlan(plans, settings);
}

export async function getPlanById(id: string): Promise<WorkoutPlan | undefined> {
  const row = await db.plans.get(id);
  return row ? migrateAll([row])[0] : undefined;
}

export async function setActivePlan(planId: string): Promise<void> {
  await updateSettings({ activePlanId: planId });
}

export async function archivePlan(planId: string, archived: boolean): Promise<void> {
  const plan = await getPlanById(planId);
  if (!plan) return;
  await db.plans.put({ ...plan, archived, updatedAt: nowIso() });
}

/**
 * Drops a plan and everything logged against it. Sessions go in the same
 * transaction: a half-applied delete would leave orphan history that no screen
 * can reach but export would still emit.
 */
export async function deletePlan(planId: string): Promise<void> {
  await db.transaction('rw', db.plans, db.sessions, db.assessments, db.settings, async () => {
    const sessions = await db.sessions.where('planId').equals(planId).toArray();
    await db.sessions.bulkDelete(sessions.map((x) => x.id));
    const assessments = await db.assessments.where('planId').equals(planId).toArray();
    await db.assessments.bulkDelete(assessments.map((a) => a.id));
    await db.plans.delete(planId);

    const settings = await db.settings.get(SETTINGS_ID);
    // Leaving activePlanId pointing at a deleted row would resolve to undefined
    // rather than falling through to the next plan.
    if (settings?.activePlanId === planId) {
      await db.settings.put({ ...settings, activePlanId: null, updatedAt: nowIso() });
    }
  });
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

/** Patches the ACTIVE plan. Use archivePlan/deletePlan for a specific one. */
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
 * Both choices are scoped to the ACTIVE plan. restartBlock used to clear the whole
 * sessions and suggestions tables, which would now wipe another program's history
 * along with this one's.
 *
 * A session also matches on `dayId` when its `planId` belongs to no plan at all:
 * the destructive confirmations promise the user that everything logged for those
 * days is gone, and a stray session from an older install would otherwise survive
 * a reset and reappear via findSessionForDay. Day ids are NOT unique across
 * programs, so that fallback is deliberately limited to orphans — matching every
 * dayId would delete another program's identically-named day.
 */
export async function applyResumeChoice(choice: ResumeChoice): Promise<void> {
  if (choice === 'resume') return;

  await db.transaction('rw', db.plans, db.settings, db.sessions, db.suggestions, async () => {
    const settings = await db.settings.get(SETTINGS_ID);
    const plan = resolveActivePlan(migrateAll(await db.plans.toArray()), settings);
    if (!plan) return;

    const knownPlanIds = new Set((await db.plans.toArray()).map((p) => p.id));
    const sessions = await db.sessions.toArray();
    const ownedBy = (dayIds: Set<string>) => (s: WorkoutSession) =>
      s.planId === plan.id || (!knownPlanIds.has(s.planId) && dayIds.has(s.dayId));

    if (choice === 'restartWeek') {
      const weekDayIds = new Set(
        plan.weeks.find((w) => w.weekNumber === plan.currentWeek)?.days.map((d) => d.id) ?? [],
      );
      await db.sessions.bulkDelete(
        sessions.filter((s) => weekDayIds.has(s.dayId) && ownedBy(weekDayIds)(s)).map((s) => s.id),
      );
      await db.plans.put({ ...plan, currentDayIndex: 0, updatedAt: nowIso() });
      return;
    }

    // restartBlock — wipe this plan's logged history and start over at week 1.
    const planDayIds = new Set(plan.weeks.flatMap((w) => w.days.map((d) => d.id)));
    await db.sessions.bulkDelete(sessions.filter(ownedBy(planDayIds)).map((x) => x.id));
    // Suggestions carry no planId, so scope them by the exercises this plan trains.
    const planExerciseIds = new Set(
      plan.weeks.flatMap((w) => w.days.flatMap((d) => d.prescriptions.map((x) => x.exerciseId))),
    );
    const suggestions = await db.suggestions.toArray();
    await db.suggestions.bulkDelete(
      suggestions.filter((x) => planExerciseIds.has(x.exerciseId)).map((x) => x.id),
    );
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
    isWarmUp: false,
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
    // Per-program: the hypertrophy program ships an empty list because its general
    // warm-up is deliberately done outside the app timer.
    warmUp: programFor(plan.programId).warmUp.map((w) => ({
      id: w.id,
      label: w.label,
      completed: false,
    })),
    warmUpCompletedAt: null,
    results: day.prescriptions.map<ExerciseResult>((p) => ({
      prescriptionId: p.id,
      exerciseId: p.exerciseId,
      plannedReps: plannedRepsLabel(p),
      // plannedSets is the WORKING set count — ramp sets are never counted as volume.
      plannedSets: p.sets,
      recommendedWeight: weightOverrides[p.exerciseId] ?? p.recommendedWeight ?? null,
      sets: [
        // Ramp sets come first, and setNumber runs unbroken across the whole array:
        // it is the only stable identity a set has, so React keys, edit targeting
        // and export rows all address rows by it. The working-set ordinal the user
        // sees is derived from position among the non-warm-up sets, in the UI.
        ...Array.from({ length: p.rampSets ?? 0 }, (_, i) => ({
          ...blankSet(i + 1),
          isWarmUp: true,
          band: p.recommendedBand,
        })),
        ...Array.from({ length: p.sets }, (_, i) => ({
          ...blankSet((p.rampSets ?? 0) + i + 1),
          weight: weightOverrides[p.exerciseId] ?? p.recommendedWeight ?? null,
          band: p.recommendedBand,
          treadmillMinutes: p.minutes ?? null,
          treadmillSpeed: p.treadmillSpeed ?? null,
          treadmillIncline: p.treadmillIncline ?? null,
        })),
      ],
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

/**
 * Both ids are required: day ids are minted per program and are not guaranteed
 * unique across them, so a dayId-only lookup can return another plan's session
 * for the same weekday slot.
 */
export async function findSessionForDay(
  dayId: string,
  planId: string,
): Promise<WorkoutSession | undefined> {
  const rows = await db.sessions.where('dayId').equals(dayId).toArray();
  return rows
    .filter((s) => s.planId === planId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
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
  if (plan.currentWeek >= plan.weeks.length) {
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
