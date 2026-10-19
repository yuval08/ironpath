import { programDefinitionSchema } from '@/data/programs/programSchema';
import { compileProgram } from '@/data/programs/compile';
import { canonicalImportExerciseId } from '@/data/exerciseAliases';
import { EXERCISE_BY_ID } from '@/data/exercises';
import { db, newId, nowIso, SETTINGS_ID } from '@/db/db';
import { defaultStartDate, getSettings } from '@/db/repository';
import { SCHEMA_VERSION, workoutPlanSchema } from '@/types';
import type { WorkoutPlan } from '@/types';
import { fingerprint } from './fingerprint';

export const MAX_PLAN_FILE_BYTES = 1024 * 1024;

/** Validate before expanding weeks or writing anything. Each import has isolated day IDs. */
export async function importPlan(
  json: unknown,
  startDate = defaultStartDate(),
): Promise<WorkoutPlan> {
  const parsed = programDefinitionSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`Invalid plan at ${issue.path.join('.') || 'root'}: ${issue.message}`);
  }
  const definition = parsed.data;
  // Normalize every reference, including key lifts and warm-up links, before
  // validation so aliases never split a movement's stored performance history.
  definition.keyLifts = definition.keyLifts.map(canonicalImportExerciseId);
  for (const item of definition.warmUp) {
    if (item.exerciseId) item.exerciseId = canonicalImportExerciseId(item.exerciseId);
  }
  for (const day of definition.days) {
    for (const block of day.blocks) {
      for (const exercise of block.exercises) {
        exercise.exercise = canonicalImportExerciseId(exercise.exercise);
        exercise.alternatives = exercise.alternatives.map(canonicalImportExerciseId);
      }
    }
  }
  const weekCount = definition.weeks.reduce((sum, week) => sum + (week.repeat ?? 1), 0);
  if (weekCount > 52) throw new Error('A plan can contain at most 52 weeks, including repeats.');
  const weekdays = definition.days.map((day) => day.weekday);
  if (new Set(weekdays).size !== weekdays.length) throw new Error('Each weekday may appear once.');
  for (const day of definition.days) {
    const keys = day.blocks.map((block) => block.key);
    if (new Set(keys).size !== keys.length)
      throw new Error(`Duplicate block key in ${day.dayType}.`);
    const exercises = day.blocks.flatMap((block) => block.exercises);
    if (exercises.length > 100) throw new Error('Each day can contain at most 100 exercises.');
    for (const exercise of exercises) {
      if (exercise.sets > 50 || exercise.rampSets > 20) {
        throw new Error('An exercise can have at most 50 working sets and 20 ramp sets.');
      }
      for (const id of [exercise.exercise, ...exercise.alternatives]) {
        if (!Object.hasOwn(EXERCISE_BY_ID, id)) throw new Error(`Unknown exercise: ${id}`);
      }
      if (['time', 'timePerSide'].includes(exercise.entryStyle) && !exercise.seconds) {
        throw new Error(`Timed exercise ${exercise.exercise} needs seconds.`);
      }
    }
  }
  const warmUpIds = definition.warmUp.map((item) => item.id);
  if (new Set(warmUpIds).size !== warmUpIds.length) throw new Error('Warm-up IDs must be unique.');
  for (const item of definition.warmUp) {
    if (item.exerciseId && !Object.hasOwn(EXERCISE_BY_ID, item.exerciseId)) {
      throw new Error(`Unknown warm-up exercise: ${item.exerciseId}`);
    }
  }
  // The file's identifiers describe its source; never let them collide with built-ins
  // or another import's prescription IDs.
  const id = newId('plan');
  const program = compileProgram({ ...definition, id: 'custom', idPrefix: id }, 'custom');
  return db.transaction('rw', db.plans, db.settings, async () => {
    const settings = await getSettings();
    if (!settings) throw new Error('Settings are unavailable. Reload the app and try again.');
    const weeks = program.buildWeeks({ weightUnit: settings.weightUnit });
    const timestamp = nowIso();
    const plan = workoutPlanSchema.parse({
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      schemaVersion: SCHEMA_VERSION,
      name: definition.name,
      startDate,
      currentWeek: 1,
      currentDayIndex: 0,
      weeks,
      pausePeriods: [],
      programId: 'custom',
      builtFingerprint: fingerprint(weeks),
      importedProgram: {
        shortName: definition.shortName,
        description: definition.description,
        warmUp: definition.warmUp,
        keyLifts: definition.keyLifts,
      },
    });
    await db.plans.add(plan);
    await db.settings.update(SETTINGS_ID, { activePlanId: id, updatedAt: timestamp });
    return plan;
  });
}
