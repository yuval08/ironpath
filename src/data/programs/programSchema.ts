import { z } from 'zod';
import {
  bandResistanceSchema,
  dayTypeSchema,
  entryStyleSchema,
  exerciseRoleSchema,
  progressionTypeSchema,
  weekPhaseSchema,
  weekdaySchema,
} from '@/types';

/**
 * The shape of a program written as data (`definitions/*.json`).
 *
 * A program file describes ONE canonical week of training days plus a schedule of
 * weeks that scale it. Nothing here is a week-by-week copy: a twelve-week block is
 * a single schedule entry with `repeat: 12`, so a change to an exercise is made in
 * exactly one place.
 *
 * Structural rules the compiler relies on are enforced here rather than trusted:
 * a superset's rest lives on the block, never on a member, which makes "rest only
 * after the last slot" impossible to get wrong by hand.
 */

const range = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([low, high]) => low <= high, 'range must be [low, high] with low <= high');

const rirRange = z
  .tuple([z.number().nonnegative(), z.number().nonnegative()])
  .refine(([low, high]) => low <= high, 'RIR must be [low, high] with low <= high');

/** Load steps are named, so a plan says "dumbbell" and each unit supplies a real jump. */
export const loadStepNameSchema = z.string().min(1);

export const programExerciseSchema = z
  .object({
    exercise: z.string().min(1),
    role: exerciseRoleSchema.default('accessory'),
    progression: progressionTypeSchema.default('fixed'),
    sets: z.number().int().positive(),
    reps: range.optional(),
    seconds: range.optional(),
    /** Target reps in reserve during full-volume weeks; a phase may override it. */
    rir: rirRange.nullable().default(null),
    loadStep: loadStepNameSchema.nullable().default(null),
    /** Non-working ramp sets offered before the working sets. */
    rampSets: z.number().int().nonnegative().default(0),
    entryStyle: entryStyleSchema.default('reps'),
    perSide: z.boolean().default(false),
    optional: z.boolean().default(false),
    band: bandResistanceSchema.optional(),
    /** Only for exercises outside a superset, or blocks of straight sets. */
    restSeconds: z.number().int().nonnegative().optional(),
    notes: z.string().optional(),
    /** Plan-specific "A OR B" choices, offered on top of the library's substitutions. */
    alternatives: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .refine((e) => e.reps != null || e.seconds != null, 'an exercise needs `reps` or `seconds`');

export const programBlockSchema = z
  .object({
    /** Short key: 'A', 'B', 'prep', 'finisher'. Superset slots become `${key}1`, `${key}2`. */
    key: z.string().min(1),
    label: z.string().min(1),
    superset: z.boolean().default(false),
    /** For a superset: rest after the whole round. Otherwise: rest after each set. */
    restSeconds: z.number().int().nonnegative().optional(),
    exercises: z.array(programExerciseSchema).min(1),
  })
  .strict()
  .superRefine((block, ctx) => {
    if (!block.superset) return;
    if (block.exercises.length < 2) {
      ctx.addIssue({ code: 'custom', message: 'a superset needs at least two exercises' });
    }
    if (block.restSeconds == null) {
      ctx.addIssue({ code: 'custom', message: 'a superset needs `restSeconds` on the block' });
    }
    block.exercises.forEach((exercise, index) => {
      if (exercise.restSeconds != null) {
        ctx.addIssue({
          code: 'custom',
          path: ['exercises', index, 'restSeconds'],
          message: 'superset members take no rest of their own — put it on the block',
        });
      }
    });
  });

export const programDaySchema = z
  .object({
    weekday: weekdaySchema,
    dayType: dayTypeSchema,
    title: z.string().min(1),
    focus: z.string(),
    blocks: z.array(programBlockSchema).min(1),
  })
  .strict();

export const programWeekSchema = z
  .object({
    phase: weekPhaseSchema,
    /** Consecutive weeks sharing this entry; `{n}` in the title becomes 1..repeat. */
    repeat: z.number().int().positive().optional(),
    title: z.string().min(1),
    focus: z.string(),
    guidance: z.array(z.string()).default([]),
    /** Caps on working sets. null = as prescribed. */
    setCap: z
      .object({
        main: z.number().int().positive().nullable().default(null),
        other: z.number().int().positive().nullable().default(null),
      })
      .strict()
      .default({}),
    /** Replaces every exercise's RIR target that week; null keeps each exercise's own. */
    rir: rirRange.nullable().default(null),
    /** Whether ramp sets are offered that week. */
    rampSets: z.boolean().default(true),
  })
  .strict();

export const programDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    shortName: z.string().min(1),
    description: z.string(),
    /**
     * Prefixed onto every day and prescription id. Required: stored sessions find
     * their day by id, so two programs minting the same `w1-upperA` would read each
     * other's history.
     */
    idPrefix: z.string().min(1),
    timing: z
      .object({
        secondsPerRep: z.number().positive().optional(),
        transitionSeconds: z.number().nonnegative().optional(),
        intraSupersetSeconds: z.number().nonnegative().optional(),
      })
      .strict()
      .default({}),
    /** Named load jumps per unit — real plate and stack steps, never a conversion. */
    loadSteps: z
      .object({
        kg: z.record(loadStepNameSchema, z.number().positive()),
        lb: z.record(loadStepNameSchema, z.number().positive()),
      })
      .strict(),
    /** In-app warm-up checklist. Empty when the general warm-up happens before the gym. */
    warmUp: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            exerciseId: z.string().min(1).optional(),
          })
          .strict(),
      )
      .default([]),
    days: z.array(programDaySchema).min(1),
    weeks: z.array(programWeekSchema).min(1),
  })
  .strict()
  .superRefine((program, ctx) => {
    for (const unit of ['kg', 'lb'] as const) {
      program.days.forEach((day, d) =>
        day.blocks.forEach((block, b) =>
          block.exercises.forEach((exercise, e) => {
            if (exercise.loadStep != null && program.loadSteps[unit][exercise.loadStep] == null) {
              ctx.addIssue({
                code: 'custom',
                path: ['days', d, 'blocks', b, 'exercises', e, 'loadStep'],
                message: `load step "${exercise.loadStep}" has no ${unit} value in loadSteps`,
              });
            }
          }),
        ),
      );
    }
    const dayTypes = program.days.map((d) => d.dayType);
    if (new Set(dayTypes).size !== dayTypes.length) {
      ctx.addIssue({ code: 'custom', path: ['days'], message: 'each dayType may appear once' });
    }
  });

export type ProgramDefinitionJson = z.infer<typeof programDefinitionSchema>;
export type ProgramBlockJson = z.infer<typeof programBlockSchema>;
export type ProgramExerciseJson = z.infer<typeof programExerciseSchema>;
export type ProgramWeekJson = z.infer<typeof programWeekSchema>;
