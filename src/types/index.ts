import { z } from 'zod';

/** Bumped whenever the persisted shape changes; see src/db/migrations.ts. */
export const SCHEMA_VERSION = 2;

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const entityBase = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.number().int(),
});
export type EntityBase = z.infer<typeof entityBase>;

export const weightUnitSchema = z.enum(['kg', 'lb']);
export type WeightUnit = z.infer<typeof weightUnitSchema>;

export const themeSchema = z.enum(['light', 'dark', 'system']);
export type ThemeMode = z.infer<typeof themeSchema>;

export const weekdaySchema = z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
export type Weekday = z.infer<typeof weekdaySchema>;

export const dayTypeSchema = z.enum(['upperA', 'lowerA', 'mobility', 'upperB', 'lowerB']);
export type DayType = z.infer<typeof dayTypeSchema>;

/** Every program the app can instantiate a plan from; see src/data/programs. */
export const programIdSchema = z.enum(['movement-resilience', 'hypertrophy-14wk']);
export type ProgramId = z.infer<typeof programIdSchema>;

/** What a week is for — drives set scaling and the guidance copy. */
export const weekPhaseSchema = z.enum(['base', 'reload', 'hypertrophy', 'deload']);
export type WeekPhase = z.infer<typeof weekPhaseSchema>;

export const exerciseRoleSchema = z.enum(['prep', 'main', 'accessory', 'finisher']);
export type ExerciseRole = z.infer<typeof exerciseRoleSchema>;

export const progressionTypeSchema = z.enum(['double', 'bandAssist', 'reps', 'time', 'fixed']);
export type ProgressionType = z.infer<typeof progressionTypeSchema>;

/** How a set is entered and displayed. */
export const entryStyleSchema = z.enum([
  'reps',
  'repsPerSide',
  'time',
  'timePerSide',
  'distance',
  'stepsPerDirection',
  'treadmill',
]);
export type EntryStyle = z.infer<typeof entryStyleSchema>;

export const loadTypeSchema = z.enum([
  'bodyweight',
  'dumbbell',
  'kettlebell',
  'barbell',
  'band',
  'machine',
  'none',
]);
export type LoadType = z.infer<typeof loadTypeSchema>;

export const bandResistanceSchema = z.enum([
  'none',
  'extraLight',
  'light',
  'medium',
  'heavy',
  'extraHeavy',
]);
export type BandResistance = z.infer<typeof bandResistanceSchema>;

/** Fallback names for the assistance bands; the user can rename them in settings. */
export const DEFAULT_BAND_LABELS: Record<BandResistance, string> = {
  extraHeavy: 'Extra heavy (most assistance)',
  heavy: 'Heavy',
  medium: 'Medium',
  light: 'Light',
  extraLight: 'Extra light',
  none: 'No band (bodyweight)',
};

export const exerciseCategorySchema = z.enum([
  'pull',
  'push',
  'row',
  'hinge',
  'squat',
  'carry',
  'core',
  'mobility',
  'balance',
  'cardio',
  'prehab',
]);
export type ExerciseCategory = z.infer<typeof exerciseCategorySchema>;

/* ------------------------------------------------------------------ */
/* Exercise library                                                    */
/* ------------------------------------------------------------------ */

export const videoReferenceSchema = z.object({
  exerciseId: z.string(),
  title: z.string(),
  creator: z.string(),
  url: z.string().url(),
  duration: z.string().optional(),
  isShort: z.boolean().optional(),
  /** true = a specific hand-verified video; false = a YouTube search URL. */
  verified: z.boolean(),
  unavailable: z.boolean().optional(),
  userProvided: z.boolean().optional(),
});
export type VideoReference = z.infer<typeof videoReferenceSchema>;

export const exerciseDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: exerciseCategorySchema,
  equipment: z.array(z.string()),
  primaryGoal: z.string(),
  instructions: z.array(z.string()),
  commonMistakes: z.array(z.string()),
  safetyNotes: z.array(z.string()),
  defaultSets: z.string(),
  defaultReps: z.string(),
  tempo: z.string().optional(),
  regression: z.string().optional(),
  progression: z.string().optional(),
  isNewMovement: z.boolean(),
  targets: z.array(z.string()),
  entryStyle: entryStyleSchema,
  loadType: loadTypeSchema,
  substitutionIds: z.array(z.string()).default([]),
  searchTerms: z.array(z.string()).default([]),
});
export type ExerciseDefinition = z.infer<typeof exerciseDefinitionSchema>;

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

export const exercisePrescriptionSchema = z.object({
  id: z.string(),
  exerciseId: z.string(),
  /** 'skill' | 'A' | 'B' | 'C' | 'D' | 'finisher' | 'section1' ... — groups supersets visually. */
  block: z.string(),
  blockLabel: z.string(),
  order: z.number().int(),
  sets: z.number().int(),
  repsLow: z.number().int().optional(),
  repsHigh: z.number().int().optional(),
  durationSecondsLow: z.number().int().optional(),
  durationSecondsHigh: z.number().int().optional(),
  minutes: z.number().optional(),
  perSide: z.boolean().default(false),
  restSeconds: z.number().int(),
  tempo: z.string().optional(),
  recommendedWeight: z.number().nullable().default(null),
  recommendedBand: bandResistanceSchema.optional(),
  treadmillSpeed: z.number().optional(),
  treadmillIncline: z.number().optional(),
  entryStyle: entryStyleSchema,
  notes: z.string().optional(),
  substitutionIds: z.array(z.string()).default([]),
  videoUrlOverride: z.string().optional(),
  optional: z.boolean().default(false),
  /** 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' — position inside a superset group. */
  slot: z.string().optional(),
  /** Prescriptions sharing this key are performed as one superset. */
  supersetKey: z.string().optional(),
  role: exerciseRoleSchema.default('accessory'),
  progressionType: progressionTypeSchema.default('fixed'),
  targetRirLow: z.number().nullable().default(null),
  targetRirHigh: z.number().nullable().default(null),
  /** Load step suggested when double progression says the top of the range is owned. */
  weightIncrement: z.number().nullable().default(null),
  /** Non-working ramp sets logged before the working sets; never counted as volume. */
  rampSets: z.number().int().default(0),
});
export type ExercisePrescription = z.infer<typeof exercisePrescriptionSchema>;

export const workoutDaySchema = z.object({
  id: z.string(),
  weekNumber: z.number().int().min(1).max(52),
  weekday: weekdaySchema,
  dayType: dayTypeSchema,
  title: z.string(),
  focus: z.string(),
  estimatedMinutes: z.number().int(),
  prescriptions: z.array(exercisePrescriptionSchema),
});
export type WorkoutDay = z.infer<typeof workoutDaySchema>;

export const weekPlanSchema = z.object({
  weekNumber: z.number().int().min(1).max(52),
  title: z.string(),
  focus: z.string(),
  guidance: z.array(z.string()),
  phase: weekPhaseSchema.default('base'),
  /** 1..12 inside the hypertrophy block; null for reload/deload/base weeks. */
  blockWeek: z.number().int().nullable().default(null),
  pushUpGoalLow: z.number().int().optional(),
  pushUpGoalHigh: z.number().int().optional(),
  days: z.array(workoutDaySchema),
});
export type WeekPlan = z.infer<typeof weekPlanSchema>;

export const pausePeriodSchema = z.object({
  id: z.string(),
  label: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  active: z.boolean(),
});
export type PausePeriod = z.infer<typeof pausePeriodSchema>;

export const workoutPlanSchema = entityBase.extend({
  name: z.string(),
  startDate: z.string(),
  /** Week the user is currently on; upper bound is the program's week count. */
  currentWeek: z.number().int().min(1),
  /** Index into the week's days array. */
  currentDayIndex: z.number().int().min(0),
  weeks: z.array(weekPlanSchema),
  pausePeriods: z.array(pausePeriodSchema),
  /** Number of times the block has been restarted from week 1. */
  restartCount: z.number().int().default(0),
  completedAt: z.string().nullable().default(null),
  programId: programIdSchema.default('movement-resilience'),
  archived: z.boolean().default(false),
});
export type WorkoutPlan = z.infer<typeof workoutPlanSchema>;

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export const setResultSchema = z.object({
  setNumber: z.number().int(),
  reps: z.number().nullable().default(null),
  repsLeft: z.number().nullable().default(null),
  repsRight: z.number().nullable().default(null),
  weight: z.number().nullable().default(null),
  band: bandResistanceSchema.optional(),
  durationSeconds: z.number().nullable().default(null),
  distanceMeters: z.number().nullable().default(null),
  treadmillMinutes: z.number().nullable().default(null),
  treadmillSpeed: z.number().nullable().default(null),
  treadmillIncline: z.number().nullable().default(null),
  rpe: z.number().nullable().default(null),
  rir: z.number().nullable().default(null),
  completed: z.boolean().default(false),
  /** Ramp/warm-up set: shown separately, excluded from volume and progression. */
  isWarmUp: z.boolean().default(false),
});
export type SetResult = z.infer<typeof setResultSchema>;

export const exerciseResultSchema = z.object({
  prescriptionId: z.string(),
  exerciseId: z.string(),
  plannedSets: z.number().int(),
  plannedReps: z.string(),
  recommendedWeight: z.number().nullable().default(null),
  sets: z.array(setResultSchema),
  completed: z.boolean().default(false),
  notes: z.string().default(''),
  painDuring: z.number().min(0).max(10).nullable().default(null),
  formGood: z.boolean().nullable().default(null),
  substitutionExerciseId: z.string().nullable().default(null),
  videoViewed: z.boolean().default(false),
  skippedReason: z.string().nullable().default(null),
  tempo: z.string().optional(),
});
export type ExerciseResult = z.infer<typeof exerciseResultSchema>;

export const painEntrySchema = z.object({
  leftKnee: z.number().min(0).max(10),
  rightKnee: z.number().min(0).max(10),
  leftShoulder: z.number().min(0).max(10),
  rightShoulder: z.number().min(0).max(10),
  lowerBack: z.number().min(0).max(10),
  fatigue: z.number().min(0).max(10),
  comments: z.string().default(''),
});
export type PainEntry = z.infer<typeof painEntrySchema>;

export const warmUpItemResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  completed: z.boolean(),
});
export type WarmUpItemResult = z.infer<typeof warmUpItemResultSchema>;

export const sessionStatusSchema = z.enum(['inProgress', 'completed', 'abandoned']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const workoutSessionSchema = entityBase.extend({
  planId: z.string(),
  dayId: z.string(),
  weekNumber: z.number().int(),
  weekday: weekdaySchema,
  dayType: dayTypeSchema,
  date: z.string(),
  status: sessionStatusSchema,
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  /** Accumulated active seconds, excluding paused time. */
  elapsedSeconds: z.number().default(0),
  warmUp: z.array(warmUpItemResultSchema),
  warmUpCompletedAt: z.string().nullable().default(null),
  results: z.array(exerciseResultSchema),
  painBefore: painEntrySchema.nullable().default(null),
  painAfter: painEntrySchema.nullable().default(null),
  sessionNotes: z.string().default(''),
  bodyweight: z.number().nullable().default(null),
});
export type WorkoutSession = z.infer<typeof workoutSessionSchema>;

/* ------------------------------------------------------------------ */
/* Records, settings, suggestions                                      */
/* ------------------------------------------------------------------ */

export const personalRecordKindSchema = z.enum([
  'strictPullUpMax',
  'chinUpMax',
  'pushUpMaxSet',
  'deadHangMaxSeconds',
  'backwardTreadmillMaxMinutes',
  'singleLegBalanceMaxSeconds',
  'negativeLoweringMaxSeconds',
]);
export type PersonalRecordKind = z.infer<typeof personalRecordKindSchema>;

export const personalRecordSchema = entityBase.extend({
  kind: personalRecordKindSchema,
  value: z.number(),
  unit: z.string(),
  date: z.string(),
  sessionId: z.string().nullable().default(null),
  notes: z.string().default(''),
});
export type PersonalRecord = z.infer<typeof personalRecordSchema>;

export const resumeChoiceSchema = z.enum(['resume', 'restartWeek', 'restartBlock']);
export type ResumeChoice = z.infer<typeof resumeChoiceSchema>;

export const userSettingsSchema = entityBase.extend({
  userName: z.string().default(''),
  weightUnit: weightUnitSchema.default('kg'),
  theme: themeSchema.default('system'),
  restDefaultSeconds: z.number().int().default(60),
  vibrateOnRestEnd: z.boolean().default(true),
  soundOnRestEnd: z.boolean().default(false),
  bodyweight: z.number().nullable().default(null),
  firstStrictPullUpDate: z.string().nullable().default(null),
  disclaimerAcknowledged: z.boolean().default(false),
  videoOverrides: z.record(z.string(), videoReferenceSchema).default({}),
  weightOverrides: z.record(z.string(), z.number()).default({}),
  autoCollapseCompleted: z.boolean().default(true),
  /** Which plan the app is currently training; null resolves to the first non-archived plan. */
  activePlanId: z.string().nullable().default(null),
  bandLabels: z.record(bandResistanceSchema, z.string()).default(DEFAULT_BAND_LABELS),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const progressionSuggestionSchema = entityBase.extend({
  exerciseId: z.string(),
  exerciseName: z.string(),
  reason: z.string(),
  recommendation: z.string(),
  kind: z.enum(['reps', 'time', 'round', 'band', 'assistance', 'angle', 'weight', 'treadmill']),
  status: z.enum(['pending', 'accepted', 'dismissed']),
  detectedAt: z.string(),
});
export type ProgressionSuggestion = z.infer<typeof progressionSuggestionSchema>;

export const finalAssessmentSchema = entityBase.extend({
  planId: z.string(),
  date: z.string(),
  maxStrictPullUps: z.number().nullable().default(null),
  maxChinUps: z.number().nullable().default(null),
  maxPushUps: z.number().nullable().default(null),
  deadHangSeconds: z.number().nullable().default(null),
  singleLegBalanceSeconds: z.number().nullable().default(null),
  kneeComfort: z.number().min(0).max(10).nullable().default(null),
  shoulderComfort: z.number().min(0).max(10).nullable().default(null),
  lowerBackComfort: z.number().min(0).max(10).nullable().default(null),
  overallEnergy: z.number().min(0).max(10).nullable().default(null),
  favoriteExercises: z.array(z.string()).default([]),
  painfulExercises: z.array(z.string()).default([]),
  readyForNextProgram: z.enum(['yes', 'partly', 'no', 'unsure']).default('unsure'),
  notes: z.string().default(''),
});
export type FinalAssessment = z.infer<typeof finalAssessmentSchema>;

/** A weight reference extracted from an imported legacy Excel tracker. */
export const importedWeightSchema = entityBase.extend({
  sourceExerciseName: z.string(),
  mappedExerciseId: z.string().nullable().default(null),
  bestWeight: z.number(),
  bestReps: z.number().nullable().default(null),
  unit: weightUnitSchema,
  occurrences: z.number().int().default(1),
  confirmed: z.boolean().default(false),
  suggestedStartWeight: z.number().nullable().default(null),
});
export type ImportedWeight = z.infer<typeof importedWeightSchema>;

export const backupFileSchema = z.object({
  // New exports write 'ironpath'; backups made before the rename still import.
  app: z.union([z.literal('movement-resilience'), z.literal('ironpath')]),
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  plans: z.array(workoutPlanSchema),
  sessions: z.array(workoutSessionSchema),
  personalRecords: z.array(personalRecordSchema),
  settings: z.array(userSettingsSchema),
  suggestions: z.array(progressionSuggestionSchema),
  assessments: z.array(finalAssessmentSchema),
  importedWeights: z.array(importedWeightSchema),
});
export type BackupFile = z.infer<typeof backupFileSchema>;

export type PainLevel = 'green' | 'yellow' | 'red';
