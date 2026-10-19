import { beforeEach, describe, expect, it } from 'vitest';
import example from '../../docs/plan-import-example.json';
import { db } from '@/db/db';
import {
  ensureSeeded,
  getPlan,
  getSettings,
  createSession,
  syncPlansWithPrograms,
  updateSettings,
} from '@/db/repository';
import { programFor } from '@/data/programs';
import { importPlan } from './planImport';
import { buildBackup, restoreBackup } from './backup';

beforeEach(async () => {
  await Promise.all([db.plans.clear(), db.settings.clear(), db.sessions.clear(), db.meta.clear()]);
  await ensureSeeded();
});

describe('JSON plan imports', () => {
  it('imports the documented example with phases, load steps, timed work, and superset rests', async () => {
    const previous = await getPlan();
    const plan = await importPlan(example);
    expect(await db.plans.get(previous!.id)).toBeDefined();
    expect((await getPlan())!.id).toBe(plan.id);
    expect(plan.weeks).toHaveLength(4);
    const prescriptions = plan.weeks[0]!.days[0]!.prescriptions;
    expect(prescriptions.map((p) => p.restSeconds)).toEqual([120, 0, 90, 60]);
    expect(prescriptions[0]!.weightIncrement).toBe(5);
    expect(prescriptions[1]!.supersetKey).toBe(prescriptions[2]!.supersetKey);
    expect(prescriptions[3]!.durationSecondsHigh).toBe(30);
    expect(plan.weeks[3]!.days[0]!.prescriptions.map((p) => p.sets)).toEqual([2, 1, 1, 1]);
    expect(plan.weeks[3]!.days[0]!.prescriptions[0]!.targetRirLow).toBe(3);
    expect(plan.weeks[3]!.days[0]!.prescriptions[0]!.rampSets).toBe(0);
    const second = await importPlan(example);
    expect(second.weeks[0]!.days[0]!.id).not.toBe(plan.weeks[0]!.days[0]!.id);
    expect(await syncPlansWithPrograms()).toEqual([]);
    expect((await db.plans.get(plan.id))!.weeks).toEqual(plan.weeks);
  });

  it('preserves program identity and warm-up through backup/restore and session creation', async () => {
    const plan = await importPlan(example);
    await restoreBackup(await buildBackup());
    const restored = (await getPlan())!;
    const program = programFor(restored);
    expect(program.name).toBe(example.name);
    expect(program.keyLifts).toEqual(example.keyLifts);
    const session = await createSession(restored, restored.weeks[0]!.days[0]!, {});
    expect(session.warmUp[0]!.label).toBe(example.warmUp[0]!.label);
    expect(session.planId).toBe(plan.id);
    await expect(updateSettings({ weightUnit: 'kg' })).rejects.toThrow(
      'Weight units cannot change',
    );
  });

  it('uses the current kg equipment increments', async () => {
    await updateSettings({ weightUnit: 'kg' });
    const plan = await importPlan(example);
    expect(plan.weeks[0]!.days[0]!.prescriptions[0]!.weightIncrement).toBe(2);
  });

  it.each([
    'unknown exercise',
    'member rest',
    'huge repeat',
    'duplicate key',
    'unknown field',
    'missing rest',
    'timed target',
  ])('rejects %s without changing plans or selection', async (scenario) => {
    const json = structuredClone(example);
    const day = json.days[0]!;
    switch (scenario) {
      case 'unknown exercise':
        day.blocks[0]!.exercises[0]!.exercise = '__proto__';
        break;
      case 'member rest':
        Object.assign(day.blocks[1]!.exercises[0]!, { restSeconds: 0 });
        break;
      case 'huge repeat':
        json.weeks[0]!.repeat = 1_000_000_000;
        break;
      case 'duplicate key':
        day.blocks[1]!.key = day.blocks[0]!.key;
        break;
      case 'unknown field':
        Object.assign(json, { sessions: [] });
        break;
      case 'missing rest':
        delete (day.blocks[0] as { restSeconds?: number }).restSeconds;
        break;
      case 'timed target':
        Object.assign(day.blocks[0]!.exercises[0]!, { entryStyle: 'time' });
        break;
    }
    const count = await db.plans.count();
    const settings = await getSettings();
    await expect(importPlan(json)).rejects.toThrow();
    expect(await db.plans.count()).toBe(count);
    expect((await getSettings())!.activePlanId).toBe(settings!.activePlanId);
  });
});
