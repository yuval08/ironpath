import { programFor } from '@/data/programs';
import { DEFAULT_BAND_LABELS, SCHEMA_VERSION } from '@/types';
import type {
  ExerciseResult,
  PainEntry,
  SetResult,
  UserSettings,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';

let counter = 0;
const id = (prefix: string) => `${prefix}_${(counter += 1)}`;
const TS = '2026-08-03T08:00:00.000Z';

/** The factories model the resilience block, which every existing test targets. */
const RESILIENCE = programFor('movement-resilience');

export function makeSet(overrides: Partial<SetResult> = {}): SetResult {
  return {
    setNumber: 1,
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
    completed: true,
    isWarmUp: false,
    ...overrides,
  };
}

export function makeResult(
  exerciseId: string,
  sets: Partial<SetResult>[],
  overrides: Partial<ExerciseResult> = {},
): ExerciseResult {
  return {
    prescriptionId: id('presc'),
    exerciseId,
    plannedSets: sets.length,
    plannedReps: '8-12',
    recommendedWeight: null,
    sets: sets.map((s, i) => makeSet({ setNumber: i + 1, ...s })),
    completed: true,
    notes: '',
    painDuring: null,
    formGood: true,
    substitutionExerciseId: null,
    videoViewed: false,
    skippedReason: null,
    ...overrides,
  };
}

export function makePain(overrides: Partial<PainEntry> = {}): PainEntry {
  return {
    leftKnee: 1,
    rightKnee: 1,
    leftShoulder: 1,
    rightShoulder: 1,
    lowerBack: 0,
    fatigue: 3,
    comments: '',
    ...overrides,
  };
}

export function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: id('session'),
    createdAt: TS,
    updatedAt: TS,
    schemaVersion: SCHEMA_VERSION,
    planId: 'plan_1',
    dayId: 'w1-upperA',
    weekNumber: 1,
    weekday: 'monday',
    dayType: 'upperA',
    date: '2026-08-03',
    status: 'completed',
    startedAt: TS,
    completedAt: TS,
    elapsedSeconds: 3000,
    warmUp: RESILIENCE.warmUp.map((w) => ({ id: w.id, label: w.label, completed: true })),
    warmUpCompletedAt: TS,
    results: [],
    painBefore: makePain(),
    painAfter: makePain(),
    sessionNotes: '',
    bodyweight: null,
    ...overrides,
  };
}

export function makePlan(overrides: Partial<WorkoutPlan> = {}): WorkoutPlan {
  return {
    id: 'plan_1',
    createdAt: TS,
    updatedAt: TS,
    schemaVersion: SCHEMA_VERSION,
    name: 'Movement & Joint Resilience — 4 Week Block',
    startDate: '2026-08-03',
    currentWeek: 1,
    currentDayIndex: 0,
    weeks: RESILIENCE.buildWeeks(),
    pausePeriods: [
      {
        id: 'pause_1',
        label: 'Travel',
        startDate: '2026-08-10',
        endDate: '2026-08-16',
        active: true,
      },
    ],
    restartCount: 0,
    completedAt: null,
    programId: 'movement-resilience',
    archived: false,
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: 'settings',
    createdAt: TS,
    updatedAt: TS,
    schemaVersion: SCHEMA_VERSION,
    userName: 'Test User',
    weightUnit: 'kg',
    theme: 'system',
    restDefaultSeconds: 60,
    vibrateOnRestEnd: true,
    soundOnRestEnd: false,
    bodyweight: 82,
    firstStrictPullUpDate: '2026-07-20',
    disclaimerAcknowledged: true,
    videoOverrides: {},
    weightOverrides: {},
    autoCollapseCompleted: true,
    activePlanId: null,
    bandLabels: DEFAULT_BAND_LABELS,
    ...overrides,
  };
}
