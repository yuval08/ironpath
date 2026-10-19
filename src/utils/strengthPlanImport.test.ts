import { beforeEach, describe, expect, it } from 'vitest';
import planFile from '@/test/fixtures/phase3-strength-foundation.json';
import { EXERCISES, EXERCISE_BY_ID } from '@/data/exercises';
import { getVideo } from '@/data/exerciseVideos';
import { EXERCISE_IMPORT_ALIASES, canonicalImportExerciseId } from '@/data/exerciseAliases';
import { exerciseDefinitionSchema } from '@/types';
import { db } from '@/db/db';
import { ensureSeeded, createSession } from '@/db/repository';
import { importPlan } from './planImport';
import { buildBackup, restoreBackup } from './backup';

beforeEach(async () => {
  await Promise.all([db.plans.clear(), db.sessions.clear(), db.settings.clear(), db.meta.clear()]);
  await ensureSeeded();
});

describe('strength foundation compatibility', () => {
  it('imports the original ten-week file, retaining rests, supersets, phases and load steps', async () => {
    const original = structuredClone(planFile);
    const plan = await importPlan(planFile);
    expect(planFile).toEqual(original);
    expect(plan.weeks).toHaveLength(10);
    expect(plan.weeks.every((week) => week.days.length === 4)).toBe(true);
    const monday = plan.weeks[2]!.days[0]!;
    expect(monday.prescriptions[0]!.exerciseId).toBe('band-assisted-pull-up');
    expect(monday.prescriptions[0]!.recommendedBand).toBe('medium');
    expect(monday.prescriptions[0]!.restSeconds).toBe(120);
    expect(monday.prescriptions[1]!.weightIncrement).toBe(5);
    const pair = monday.prescriptions.filter((p) => p.block === 'ma-arms');
    expect(pair.map((p) => p.restSeconds)).toEqual([0, 75]);
    expect(pair[0]!.supersetKey).toBe(pair[1]!.supersetKey);
    expect(plan.weeks[5]!.phase).toBe('deload');
    expect(plan.weeks[5]!.days[0]!.prescriptions[0]!.sets).toBe(2);
    expect(plan.importedProgram!.keyLifts).toContain('band-assisted-pull-up');
    for (const p of plan.weeks.flatMap((w) => w.days.flatMap((d) => d.prescriptions))) {
      expect(exerciseDefinitionSchema.safeParse(EXERCISE_BY_ID[p.exerciseId]).success).toBe(true);
      expect(getVideo(p.exerciseId)).toBeDefined();
      for (const id of p.substitutionIds) expect(Object.hasOwn(EXERCISE_BY_ID, id)).toBe(true);
    }
    const session = await createSession(plan, monday, {});
    expect(session.results[1]!.exerciseId).toBe('incline-barbell-bench-press');
    await restoreBackup(await buildBackup());
    expect((await db.plans.get(plan.id))!.weeks).toEqual(plan.weeks);
  });

  it('normalizes aliases in prescriptions, alternatives, warm-ups and key lifts', async () => {
    const raw = structuredClone(planFile);
    Object.assign(raw.days[0]!.blocks[0]!.exercises[0]!, {
      alternatives: ['flat-dumbbell-bench-press'],
    });
    Object.assign(raw.warmUp[0]!, { exerciseId: 'assisted-pull-up' });
    const plan = await importPlan(raw);
    expect(plan.weeks[0]!.days[0]!.prescriptions[0]!.substitutionIds).toContain(
      'flat-dumbbell-press',
    );
    expect(plan.importedProgram!.warmUp[0]!.exerciseId).toBe('band-assisted-pull-up');
    for (const [alias, canonical] of Object.entries(EXERCISE_IMPORT_ALIASES)) {
      expect(canonicalImportExerciseId(alias)).toBe(canonical);
      expect(Object.hasOwn(EXERCISE_BY_ID, canonical)).toBe(true);
    }
    expect(canonicalImportExerciseId('__proto__')).toBe('__proto__');
  });

  it('keeps library IDs unique and valid', () => {
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    for (const exercise of EXERCISES)
      expect(exerciseDefinitionSchema.safeParse(exercise).success).toBe(true);
  });
});
