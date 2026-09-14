import type {
  DayType,
  ExercisePrescription,
  ProgramId,
  WeekPlan,
  WeightUnit,
  WorkoutDay,
} from '@/types';
import { EXERCISE_BY_ID } from '../exercises';
import { substitutionsFor } from '../substitutions';
import { estimateSessionMinutes, type TimingOptions } from './timing';
import type { BuildOptions, ProgramDefinition } from './index';
import {
  programDefinitionSchema,
  type ProgramBlockJson,
  type ProgramDefinitionJson,
  type ProgramExerciseJson,
  type ProgramWeekJson,
} from './programSchema';

/**
 * Turns a program written as data into the `ProgramDefinition` every screen, the
 * repository and the exporter already consume. The JSON is the single source of
 * truth for WHAT is trained; this module owns HOW a canonical week becomes fifteen
 * stored ones, so editing a plan never means editing code.
 */

const FALLBACK_DAY_LABELS: Record<DayType, string> = {
  upperA: 'Upper A',
  lowerA: 'Lower A',
  mobility: 'Mobility',
  upperB: 'Upper B',
  lowerB: 'Lower B',
};

function capped(base: number, cap: number | null): number {
  return cap == null ? base : Math.min(base, cap);
}

function unknownExercise(programId: string, where: string, id: string): Error {
  return new Error(
    `Program "${programId}" references unknown exercise "${id}" (${where}). ` +
      'Add it to src/data/exercises.ts or fix the id.',
  );
}

interface CompileContext {
  program: ProgramDefinitionJson;
  unit: WeightUnit;
  week: ProgramWeekJson;
  weekNumber: number;
  dayType: DayType;
}

function compileExercise(
  ctx: CompileContext,
  block: ProgramBlockJson,
  exercise: ProgramExerciseJson,
  index: number,
  order: number,
): ExercisePrescription {
  const { program, unit, week, weekNumber, dayType } = ctx;
  const last = index === block.exercises.length - 1;

  // A superset rests once, after its final slot. Everything before it is 0 — the
  // value the UI, the time estimate and the tests all read as "go straight on".
  const restSeconds = block.superset
    ? last
      ? (block.restSeconds ?? 0)
      : 0
    : (exercise.restSeconds ?? block.restSeconds);
  if (restSeconds == null) {
    throw new Error(
      `Program "${program.id}": "${exercise.exercise}" in block "${block.key}" has no restSeconds.`,
    );
  }

  const sets = capped(
    exercise.sets,
    exercise.role === 'main' ? week.setCap.main : week.setCap.other,
  );
  // An exercise with no RIR target (prep, rep-progressed finishers) never gains one.
  const rir = week.rir != null && exercise.rir != null ? week.rir : exercise.rir;

  return {
    id: `${program.idPrefix}-w${weekNumber}-${dayType}-${exercise.exercise}-${order}`,
    exerciseId: exercise.exercise,
    block: block.key,
    blockLabel: block.label,
    slot: block.superset ? `${block.key}${index + 1}` : undefined,
    supersetKey: block.superset ? `${dayType}-${block.key}` : undefined,
    order,
    role: exercise.role,
    progressionType: exercise.progression,
    sets,
    repsLow: exercise.reps?.[0],
    repsHigh: exercise.reps?.[1],
    durationSecondsLow: exercise.seconds?.[0],
    durationSecondsHigh: exercise.seconds?.[1],
    restSeconds,
    entryStyle: exercise.entryStyle,
    recommendedBand: exercise.band,
    targetRirLow: rir ? rir[0] : null,
    targetRirHigh: rir ? rir[1] : null,
    weightIncrement:
      exercise.loadStep == null ? null : (program.loadSteps[unit][exercise.loadStep] ?? null),
    rampSets: week.rampSets ? exercise.rampSets : 0,
    notes: exercise.notes,
    perSide: exercise.perSide,
    optional: exercise.optional,
    recommendedWeight: null,
    substitutionIds: [
      ...new Set([...substitutionsFor(exercise.exercise), ...exercise.alternatives]),
    ],
  };
}

function compileDay(
  program: ProgramDefinitionJson,
  day: ProgramDefinitionJson['days'][number],
  week: ProgramWeekJson,
  weekNumber: number,
  unit: WeightUnit,
  timing: TimingOptions,
): WorkoutDay {
  const ctx: CompileContext = { program, unit, week, weekNumber, dayType: day.dayType };
  let order = 0;
  const prescriptions = day.blocks.flatMap((block) =>
    block.exercises.map((exercise, index) => {
      order += 1;
      return compileExercise(ctx, block, exercise, index, order);
    }),
  );
  return {
    id: `${program.idPrefix}-w${weekNumber}-${day.dayType}`,
    weekNumber,
    weekday: day.weekday,
    dayType: day.dayType,
    title: day.title,
    focus: day.focus,
    // Computed, never hand-written — a stale constant hid a real overrun.
    estimatedMinutes: estimateSessionMinutes(prescriptions, timing),
    prescriptions,
  };
}

interface ScheduledWeek {
  week: ProgramWeekJson;
  /** 1..repeat inside a repeated block; null for a one-off week. */
  blockWeek: number | null;
}

/** Expands `repeat` entries into consecutive weeks, numbering the block within them. */
function scheduleWeeks(weeks: ProgramWeekJson[]): ScheduledWeek[] {
  return weeks.flatMap((week): ScheduledWeek[] =>
    week.repeat == null
      ? [{ week, blockWeek: null }]
      : Array.from({ length: week.repeat }, (_, i) => ({ week, blockWeek: i + 1 })),
  );
}

function assertExercisesExist(program: ProgramDefinitionJson): void {
  for (const day of program.days) {
    for (const block of day.blocks) {
      for (const exercise of block.exercises) {
        const where = `${day.dayType} / ${block.key}`;
        if (!EXERCISE_BY_ID[exercise.exercise]) {
          throw unknownExercise(program.id, where, exercise.exercise);
        }
        for (const alt of exercise.alternatives) {
          if (!EXERCISE_BY_ID[alt]) throw unknownExercise(program.id, `${where} alternative`, alt);
        }
      }
    }
  }
}

/**
 * Validates and compiles a JSON program. Throws with the offending path on a bad
 * file — a broken plan must fail the test suite, not render a half-built workout.
 */
export function compileProgram(raw: unknown, id: ProgramId): ProgramDefinition {
  const parsed = programDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Program "${id}" is not a valid program definition:\n${issues}`);
  }
  const program = parsed.data;
  if (program.id !== id) {
    throw new Error(`Program file declares id "${program.id}" but is registered as "${id}".`);
  }
  assertExercisesExist(program);

  const timing: TimingOptions = program.timing;
  const schedule = scheduleWeeks(program.weeks);

  const buildWeeks = ({ weightUnit = 'lb' }: BuildOptions = {}): WeekPlan[] =>
    schedule.map(({ week, blockWeek }, index) => {
      const weekNumber = index + 1;
      return {
        weekNumber,
        title: blockWeek == null ? week.title : week.title.replaceAll('{n}', String(blockWeek)),
        focus: week.focus,
        guidance: week.guidance,
        phase: week.phase,
        blockWeek,
        days: program.days.map((day) =>
          compileDay(program, day, week, weekNumber, weightUnit, timing),
        ),
      };
    });

  const dayLabels = { ...FALLBACK_DAY_LABELS };
  for (const day of program.days) dayLabels[day.dayType] = day.title;

  return {
    id,
    name: program.name,
    shortName: program.shortName,
    description: program.description,
    weekCount: schedule.length,
    daysPerWeek: program.days.length,
    warmUp: program.warmUp,
    dayLabels,
    buildWeeks,
  };
}
