import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { migrateRecord } from './migrations';
import {
  applyResumeChoice,
  archivePlan,
  completeSession,
  createPlanFromProgram,
  createSession,
  currentDay,
  defaultStartDate,
  deletePlan,
  ensureSeeded,
  findSessionForDay,
  getPlan,
  getPlanById,
  getPlans,
  getSettings,
  IRONPATH_SEED_META_KEY,
  isPausedOn,
  projectedDate,
  recordPR,
  saveSession,
  updateSettings,
  setActivePlan,
  syncPlansWithPrograms,
  applyProgramUpdate,
} from './repository';
import { fingerprint } from '@/utils/fingerprint';
import { programFor } from '@/data/programs';
import { makeResult } from '@/test/factories';
import { DEFAULT_BAND_LABELS, SCHEMA_VERSION } from '@/types';
import type { WorkoutPlan } from '@/types';

async function reset() {
  await Promise.all([
    db.plans.clear(),
    db.sessions.clear(),
    db.settings.clear(),
    db.personalRecords.clear(),
    db.suggestions.clear(),
    db.assessments.clear(),
    // The seed guard lives here; leaving it set would suppress seeding in the next test.
    db.meta.clear(),
  ]);
}

/** Makes `programId` the active plan, creating it if the seed did not. */
async function activatePlan(programId: 'movement-resilience' | 'hypertrophy-14wk') {
  const existing = (await getPlans()).find((p) => p.programId === programId);
  const plan = existing ?? (await createPlanFromProgram(programId));
  await setActivePlan(plan.id);
  return (await getPlanById(plan.id))!;
}

describe('seeding', () => {
  beforeEach(reset);

  it('creates the default program plan, default settings and makes it active', async () => {
    const { plan, settings } = await ensureSeeded();
    expect(plan.programId).toBe('hypertrophy-14wk');
    expect(plan.weeks).toHaveLength(15);
    expect(plan.archived).toBe(false);
    expect(settings.weightUnit).toBe('lb');
    expect(settings.activePlanId).toBe(plan.id);
    expect(settings.bandLabels).toEqual(DEFAULT_BAND_LABELS);
  });

  it('gives a resilience plan its travel pause', async () => {
    await reset();
    const plan = await createPlanFromProgram('movement-resilience');
    expect(plan.weeks).toHaveLength(4);
    expect(plan.pausePeriods[0]).toMatchObject({ label: 'Travel', active: true });
    expect(plan.pausePeriods[0]!.startDate).toMatch(/-08-10$/);
    expect(plan.pausePeriods[0]!.endDate).toMatch(/-08-16$/);
  });

  it('is idempotent', async () => {
    const first = await ensureSeeded();
    const second = await ensureSeeded();
    expect(second.plan.id).toBe(first.plan.id);
    expect(await db.plans.count()).toBe(1);
  });

  it('starts the plan on the next Monday', () => {
    // 2026-07-31 is a Friday.
    expect(defaultStartDate(new Date('2026-07-31T12:00:00'))).toBe('2026-08-03');
  });
});

/**
 * The hypertrophy plan is added to installs that predate Ironpath. It must never
 * touch the resilience plan or its sessions, and must never run a second time —
 * a user who deletes it is entitled to keep it deleted.
 */
describe('ensureSeeded on an existing resilience install', () => {
  beforeEach(reset);

  it('adds the hypertrophy plan alongside the resilience plan without touching it', async () => {
    const legacy = await createPlanFromProgram('movement-resilience');
    const session = await createSession(legacy, legacy.weeks[0]!.days[0]!, {});

    const { plan } = await ensureSeeded();

    expect(plan.programId).toBe('hypertrophy-14wk');
    expect(await db.plans.count()).toBe(2);
    expect(await getPlanById(legacy.id)).toBeDefined();
    expect((await getPlanById(legacy.id))!.weeks).toHaveLength(4);
    expect(await db.sessions.get(session.id)).toBeDefined();
    expect((await getSettings())!.activePlanId).toBe(plan.id);
  });

  it('seeds the hypertrophy plan only once, even after the user deletes it', async () => {
    await createPlanFromProgram('movement-resilience');
    const { plan } = await ensureSeeded();
    expect(await db.meta.get(IRONPATH_SEED_META_KEY)).toBeDefined();

    await deletePlan(plan.id);
    await ensureSeeded();

    expect(await db.plans.count()).toBe(1);
    expect((await getPlans())[0]!.programId).toBe('movement-resilience');
  });

  it('does not add a second hypertrophy plan when one already exists', async () => {
    await ensureSeeded();
    await db.meta.clear(); // even with the guard gone, the existing plan is enough
    await ensureSeeded();
    expect(await db.plans.count()).toBe(1);
  });
});

describe('active plan resolution', () => {
  beforeEach(reset);

  it('prefers settings.activePlanId', async () => {
    await ensureSeeded();
    const legacy = await createPlanFromProgram('movement-resilience');
    await setActivePlan(legacy.id);
    expect((await getPlan())!.id).toBe(legacy.id);
  });

  it('falls back to the first non-archived plan when nothing is pinned', async () => {
    const { plan } = await ensureSeeded();
    const legacy = await createPlanFromProgram('movement-resilience');
    await archivePlan(plan.id, true);
    await db.settings.put({ ...(await getSettings())!, activePlanId: null });

    expect((await getPlan())!.id).toBe(legacy.id);
  });

  it('falls back to the first plan when every plan is archived', async () => {
    const { plan } = await ensureSeeded();
    await archivePlan(plan.id, true);
    await db.settings.put({ ...(await getSettings())!, activePlanId: null });
    expect((await getPlan())!.id).toBe(plan.id);
  });

  it('re-resolves after the active plan is deleted', async () => {
    const { plan } = await ensureSeeded();
    const legacy = await createPlanFromProgram('movement-resilience');
    await deletePlan(plan.id);
    expect((await getSettings())!.activePlanId).toBeNull();
    expect((await getPlan())!.id).toBe(legacy.id);
  });

  it('finds a day’s session only within the plan that owns it', async () => {
    const { plan: active } = await ensureSeeded();
    const other = await createPlanFromProgram('movement-resilience');
    const mine = await createSession(active, currentDay(active)!, {});
    const theirs = await createSession(other, other.weeks[0]!.days[0]!, {});

    expect((await findSessionForDay(mine.dayId, active.id))?.id).toBe(mine.id);
    expect((await findSessionForDay(theirs.dayId, other.id))?.id).toBe(theirs.id);
    expect(await findSessionForDay(mine.dayId, 'plan_that_does_not_exist')).toBeUndefined();
  });

  it('deletes a plan together with its sessions', async () => {
    const { plan, settings } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, settings.weightOverrides);
    await deletePlan(plan.id);
    expect(await db.sessions.get(session.id)).toBeUndefined();
    expect(await db.plans.get(plan.id)).toBeUndefined();
  });
});

describe('pause handling', () => {
  beforeEach(reset);

  it('reports a date inside the travel window as paused', async () => {
    const plan = await activatePlan('movement-resilience');
    const year = new Date(plan.startDate).getFullYear();
    expect(isPausedOn(plan, new Date(`${year}-08-12T09:00:00`))).toBe(true);
    expect(isPausedOn(plan, new Date(`${year}-08-09T09:00:00`))).toBe(false);
    expect(isPausedOn(plan, new Date(`${year}-08-17T09:00:00`))).toBe(false);
  });

  it('pushes projected dates past an active pause', async () => {
    const plan = await activatePlan('movement-resilience');
    const pause = plan.pausePeriods[0]!;
    const dates = plan.weeks.flatMap((w) =>
      w.days.map((_, i) => projectedDate(plan, w.weekNumber, i)),
    );
    const inside = dates.filter((d) => d >= pause.startDate && d <= pause.endDate);
    expect(inside).toEqual([]);
  });

  it('ignores an inactive pause', async () => {
    const plan = await activatePlan('movement-resilience');
    const off = { ...plan, pausePeriods: plan.pausePeriods.map((p) => ({ ...p, active: false })) };
    const year = new Date(plan.startDate).getFullYear();
    expect(isPausedOn(off, new Date(`${year}-08-12T09:00:00`))).toBe(false);
  });
});

describe('session lifecycle', () => {
  beforeEach(reset);

  it('creates a session with one result per prescription and blank sets', async () => {
    const { plan, settings } = await ensureSeeded();
    const day = currentDay(plan)!;
    const session = await createSession(plan, day, settings.weightOverrides);

    expect(session.results).toHaveLength(day.prescriptions.length);
    expect(session.status).toBe('inProgress');
    expect(session.warmUp.every((w) => !w.completed)).toBe(true);
    const first = session.results[0]!;
    expect(first.sets.filter((s) => !s.isWarmUp)).toHaveLength(first.plannedSets);
    expect(first.sets.every((s) => !s.completed)).toBe(true);
  });

  it('takes its warm-up checklist from the plan’s own program', async () => {
    await reset();
    const resilience = await activatePlan('movement-resilience');
    const withWarmUp = await createSession(resilience, currentDay(resilience)!, {});
    expect(withWarmUp.warmUp).toHaveLength(8);

    const { plan } = await ensureSeeded();
    const hypertrophy = await createSession(plan, currentDay(plan)!, {});
    // The hypertrophy program's general warm-up happens outside the app timer.
    expect(hypertrophy.warmUp).toEqual([]);
  });

  it('emits ramp sets first, flagged as warm-up and excluded from plannedSets', async () => {
    const { plan } = await ensureSeeded();
    const day = structuredClone(currentDay(plan)!);
    day.prescriptions[0] = { ...day.prescriptions[0]!, sets: 3, rampSets: 2 };

    const session = await createSession(plan, day, {});
    const result = session.results[0]!;

    expect(result.plannedSets).toBe(3);
    expect(result.sets).toHaveLength(5);
    expect(result.sets.slice(0, 2).every((s) => s.isWarmUp)).toBe(true);
    expect(result.sets.slice(2).every((s) => !s.isWarmUp)).toBe(true);
    // setNumber is the only stable identity a set has — React keys and export rows
    // address rows by it, so it must not restart at 1 for the working sets.
    expect(result.sets.filter((s) => s.isWarmUp).map((s) => s.setNumber)).toEqual([1, 2]);
    expect(result.sets.filter((s) => !s.isWarmUp).map((s) => s.setNumber)).toEqual([3, 4, 5]);
  });

  it('gives every set in a result a unique setNumber', async () => {
    const { plan } = await ensureSeeded();
    const day = structuredClone(currentDay(plan)!);
    day.prescriptions = day.prescriptions.map((p, i) => ({ ...p, sets: 3, rampSets: i % 3 }));

    const session = await createSession(plan, day, {});

    for (const result of session.results) {
      const numbers = result.sets.map((x) => x.setNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    }
  });

  it('creates no ramp sets when the prescription asks for none', async () => {
    const { plan } = await ensureSeeded();
    const day = structuredClone(currentDay(plan)!);
    day.prescriptions = day.prescriptions.map((p) => ({ ...p, rampSets: 0 }));
    const session = await createSession(plan, day, {});
    expect(session.results.every((r) => r.sets.every((s) => !s.isWarmUp))).toBe(true);
  });

  it('seeds recommended weights from the confirmed import overrides', async () => {
    const plan = await activatePlan('movement-resilience');
    const day = plan.weeks[0]!.days.find((d) => d.dayType === 'lowerB')!;
    const session = await createSession(plan, day, { 'hip-thrust': 45 });
    const hipThrust = session.results.find((r) => r.exerciseId === 'hip-thrust')!;
    expect(hipThrust.recommendedWeight).toBe(45);
    expect(hipThrust.sets.every((s) => s.weight === 45)).toBe(true);
  });

  it('advances the day cursor on completion', async () => {
    const { plan, settings } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, settings.weightOverrides);
    await completeSession(session);

    const updated = (await getPlan())!;
    expect(updated.currentWeek).toBe(1);
    expect(updated.currentDayIndex).toBe(1);
  });

  it('advances the session’s own plan after the active program is switched', async () => {
    const { plan } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, {});
    const other = await createPlanFromProgram('movement-resilience');
    await setActivePlan(other.id);

    await completeSession(session);

    expect((await getPlanById(plan.id))!.currentDayIndex).toBe(1);
    expect((await getPlanById(other.id))!.currentDayIndex).toBe(0);
    expect((await db.sessions.get(session.id))!.status).toBe('completed');
  });

  it('rolls back completion when advancing the plan fails, allowing retry', async () => {
    const { plan } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, {});
    const write = vi.spyOn(db.plans, 'put').mockRejectedValueOnce(new Error('Write failed'));
    try {
      await expect(completeSession(session)).rejects.toThrow('Write failed');
    } finally {
      write.mockRestore();
    }

    expect((await db.sessions.get(session.id))!.status).toBe('inProgress');
    expect((await getPlanById(plan.id))!.currentDayIndex).toBe(0);
    await completeSession(session);
    expect((await db.sessions.get(session.id))!.status).toBe('completed');
    expect((await getPlanById(plan.id))!.currentDayIndex).toBe(1);
  });

  it('serializes simultaneous completions and retains the first committed result', async () => {
    const { plan } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, {});

    await Promise.all([
      completeSession({ ...session, sessionNotes: 'First finish' }),
      completeSession({ ...session, sessionNotes: 'Stale second finish' }),
    ]);

    expect((await db.sessions.get(session.id))!.sessionNotes).toBe('First finish');
    expect((await getPlanById(plan.id))!.currentDayIndex).toBe(1);
  });

  it('rejects stale autosaves after completion instead of reopening and overwriting the workout', async () => {
    const { plan } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, {});
    await completeSession({ ...session, sessionNotes: 'Completed workout' });

    await saveSession({ ...session, sessionNotes: 'Old tab' });

    expect(await db.sessions.get(session.id)).toMatchObject({
      status: 'completed',
      sessionNotes: 'Completed workout',
    });
  });

  it('does not resurrect a deleted session when a stale autosave arrives', async () => {
    const { plan } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, {});
    await db.sessions.delete(session.id);

    await saveSession(session);

    expect(await db.sessions.get(session.id)).toBeUndefined();
  });

  it('leaves an abandoned session and its plan cursor unchanged on stale completion', async () => {
    const { plan } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, {});
    await saveSession({ ...session, status: 'abandoned' });

    await expect(completeSession(session)).rejects.toThrow('removed or abandoned');

    expect((await db.sessions.get(session.id))!.status).toBe('abandoned');
    expect((await getPlanById(plan.id))!.currentDayIndex).toBe(0);
  });

  it('rolls into the next week after the last day of the week', async () => {
    const { plan: seeded, settings } = await ensureSeeded();
    const daysInWeek = seeded.weeks[0]!.days.length;
    for (let i = 0; i < daysInWeek; i += 1) {
      const plan = (await getPlan())!;
      const session = await createSession(plan, currentDay(plan)!, settings.weightOverrides);
      await completeSession(session);
    }
    const updated = (await getPlan())!;
    expect(updated.currentWeek).toBe(2);
    expect(updated.currentDayIndex).toBe(0);
  });

  it('marks the plan complete after the final day of the final week', async () => {
    const { plan } = await ensureSeeded();
    const lastWeek = plan.weeks[plan.weeks.length - 1]!;
    await db.plans.put({
      ...plan,
      currentWeek: lastWeek.weekNumber,
      currentDayIndex: lastWeek.days.length - 1,
    });
    const ready = (await getPlan())!;
    const session = await createSession(ready, currentDay(ready)!, {});
    await completeSession(session);
    expect((await getPlan())!.completedAt).not.toBeNull();
  });

  it('does not complete the plan at week 4 of a 15-week program', async () => {
    const { plan } = await ensureSeeded();
    await db.plans.put({
      ...plan,
      currentWeek: 4,
      currentDayIndex: plan.weeks[3]!.days.length - 1,
    });
    const ready = (await getPlan())!;
    const session = await createSession(ready, currentDay(ready)!, {});
    await completeSession(session);

    const updated = (await getPlan())!;
    expect(updated.completedAt).toBeNull();
    expect(updated.currentWeek).toBe(5);
  });
});

describe('weight unit integrity', () => {
  beforeEach(reset);

  it('allows changing units before any weights or workouts have been stored', async () => {
    const { plan } = await ensureSeeded();
    await updateSettings({ weightUnit: 'kg' });
    expect((await getSettings())!.weightUnit).toBe('kg');
    expect((await getPlanById(plan.id))!.weeks).toEqual(
      programFor(plan.programId).buildWeeks({ weightUnit: 'kg' }),
    );
  });

  it('rolls back the unit change if rebuilding its prescription load steps fails', async () => {
    await ensureSeeded();
    const write = vi.spyOn(db.plans, 'put').mockRejectedValueOnce(new Error('Plan write failed'));
    try {
      await expect(updateSettings({ weightUnit: 'kg' })).rejects.toThrow('Plan write failed');
    } finally {
      write.mockRestore();
    }
    expect((await getSettings())!.weightUnit).toBe('lb');
  });

  it.each(['session', 'bodyweight', 'override', 'plan edit', 'plan load'] as const)(
    'rejects relabeling existing %s weights',
    async (source) => {
      const { plan } = await ensureSeeded();
      if (source === 'session') await createSession(plan, currentDay(plan)!, {});
      if (source === 'bodyweight') await updateSettings({ bodyweight: 180 });
      if (source === 'override') await updateSettings({ weightOverrides: { squat: 100 } });
      if (source === 'plan edit') {
        const edited = structuredClone(plan);
        edited.weeks[0]!.days[0]!.prescriptions[0]!.sets += 1;
        await db.plans.put(edited);
      }
      if (source === 'plan load') await createPlanFromProgram('movement-resilience');

      await expect(updateSettings({ weightUnit: 'kg' })).rejects.toThrow(
        'Weight units cannot change',
      );
      expect((await getSettings())!.weightUnit).toBe('lb');
      // Other settings remain editable, including saving the already selected unit.
      await updateSettings({ weightUnit: 'lb', userName: 'Changed' });
      expect((await getSettings())!.userName).toBe('Changed');
    },
  );
});

describe('resume choices', () => {
  beforeEach(reset);

  it('resume keeps everything in place', async () => {
    const { plan, settings } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, settings.weightOverrides);
    await completeSession(session);
    await applyResumeChoice('resume');

    expect(await db.sessions.count()).toBe(1);
    expect((await getPlan())!.currentDayIndex).toBe(1);
  });

  it('restartWeek deletes this week’s sessions and rewinds to day 1', async () => {
    const { plan, settings } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, settings.weightOverrides);
    await completeSession(session);
    await applyResumeChoice('restartWeek');

    expect(await db.sessions.count()).toBe(0);
    const updated = (await getPlan())!;
    expect(updated.currentWeek).toBe(1);
    expect(updated.currentDayIndex).toBe(0);
  });

  it('restartBlock clears this plan’s sessions and returns to week 1 with a bumped restart count', async () => {
    const { plan: seeded, settings } = await ensureSeeded();
    for (let i = 0; i < seeded.weeks[0]!.days.length + 1; i += 1) {
      const plan = (await getPlan())!;
      const session = await createSession(plan, currentDay(plan)!, settings.weightOverrides);
      await completeSession(session);
    }
    expect((await getPlan())!.currentWeek).toBe(2);

    await applyResumeChoice('restartBlock');
    const updated = (await getPlan())!;
    expect(await db.sessions.count()).toBe(0);
    expect(updated.currentWeek).toBe(1);
    expect(updated.currentDayIndex).toBe(0);
    expect(updated.restartCount).toBe(1);
  });

  it('restartBlock leaves another plan’s sessions and suggestions untouched', async () => {
    const { plan: active, settings } = await ensureSeeded();
    const other = await createPlanFromProgram('movement-resilience');
    const otherSession = await createSession(other, other.weeks[0]!.days[0]!, {});
    const otherExerciseId = otherSession.results[0]!.exerciseId;
    await db.suggestions.put({
      id: 'sugg_other',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
      exerciseId: `${otherExerciseId}-not-in-active-plan`,
      exerciseName: 'Other plan only',
      reason: '',
      recommendation: '',
      kind: 'weight',
      status: 'pending',
      detectedAt: '2026-08-01T00:00:00.000Z',
    });

    const mine = await createSession(active, currentDay(active)!, settings.weightOverrides);
    await applyResumeChoice('restartBlock');

    expect(await db.sessions.get(mine.id)).toBeUndefined();
    expect(await db.sessions.get(otherSession.id)).toBeDefined();
    expect(await db.suggestions.get('sugg_other')).toBeDefined();
  });
});

describe('personal records', () => {
  beforeEach(reset);

  it('only stores a record when it beats the previous best', async () => {
    expect(await recordPR('strictPullUpMax', 2, 'reps')).not.toBeNull();
    expect(await recordPR('strictPullUpMax', 2, 'reps')).toBeNull();
    expect(await recordPR('strictPullUpMax', 3, 'reps')).not.toBeNull();
    expect(await db.personalRecords.count()).toBe(2);
  });
});

/**
 * migrateRecord runs over every table, so each case is asserted on a raw v1 row
 * of the shape the corresponding store actually held.
 */
describe('v1 → v2 record migration', () => {
  it('upgrades a plan row, its weeks and its prescriptions', () => {
    const v1 = {
      id: 'plan_v1',
      schemaVersion: 1,
      name: 'Movement & Joint Resilience — 4 Week Block',
      currentWeek: 1,
      weeks: [
        {
          weekNumber: 1,
          title: 'Week 1',
          days: [
            {
              id: 'w1-upperA',
              weekNumber: 1,
              prescriptions: [{ id: 'p1', exerciseId: 'x', sets: 3 }],
            },
          ],
        },
      ],
    };
    const out = migrateRecord(v1) as unknown as WorkoutPlan;

    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.programId).toBe('movement-resilience');
    // v3: a plan from before build fingerprints is marked as having none.
    expect(out.builtFingerprint).toBeNull();
    expect(out.archived).toBe(false);
    expect(out.weeks[0]).toMatchObject({ phase: 'base', blockWeek: null });
    expect(out.weeks[0]!.days[0]!.prescriptions[0]).toMatchObject({
      role: 'accessory',
      progressionType: 'fixed',
      targetRirLow: null,
      targetRirHigh: null,
      weightIncrement: null,
      rampSets: 0,
    });
  });

  it('flags every existing set as a working set', () => {
    const v1 = {
      id: 'session_v1',
      schemaVersion: 1,
      planId: 'plan_v1',
      results: [{ prescriptionId: 'p1', sets: [{ setNumber: 1, reps: 10 }, { setNumber: 2 }] }],
    };
    const out = migrateRecord(v1) as unknown as { results: { sets: { isWarmUp: boolean }[] }[] };
    expect(out.results[0]!.sets.every((s) => s.isWarmUp === false)).toBe(true);
  });

  it('gives a settings row an unset active plan and the default band labels', () => {
    const v1 = { id: 'settings', schemaVersion: 1, weightUnit: 'kg', theme: 'system' };
    const out = migrateRecord(v1) as unknown as { activePlanId: null; bandLabels: unknown };
    expect(out.activePlanId).toBeNull();
    expect(out.bandLabels).toEqual(DEFAULT_BAND_LABELS);
  });

  it('leaves rows that match none of the shapes alone', () => {
    const pr = { id: 'pr_1', schemaVersion: 1, kind: 'pushUpMaxSet', value: 20 };
    expect(migrateRecord(pr)).toEqual({ ...pr, schemaVersion: SCHEMA_VERSION });
  });

  it('does not re-run over a row that is already v2', () => {
    const v2 = { id: 'settings', schemaVersion: 2, weightUnit: 'kg', bandLabels: { none: 'Mine' } };
    expect((migrateRecord(v2) as { bandLabels: unknown }).bandLabels).toEqual({ none: 'Mine' });
  });
});

/**
 * Regression tests for defects found in review. Each one silently corrupted the
 * plan cursor or duplicated state, so they are locked down explicitly.
 */
describe('concurrency and out-of-order guards', () => {
  beforeEach(reset);

  it('never creates a second plan when ensureSeeded races with itself', async () => {
    // React 18 StrictMode double-invokes the seeding effect; two tabs do the same.
    const [a, b] = await Promise.all([ensureSeeded(), ensureSeeded()]);
    expect(await db.plans.count()).toBe(1);
    expect(await db.settings.count()).toBe(1);
    expect(a.plan.id).toBe(b.plan.id);
  });

  it('does not advance the cursor twice when the same session is completed twice', async () => {
    const { plan, settings } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, settings.weightOverrides);

    await completeSession(session);
    await completeSession(session); // double-tap on Finish

    const updated = (await getPlan())!;
    expect(updated.currentWeek).toBe(1);
    expect(updated.currentDayIndex).toBe(1);
  });

  it('leaves the cursor alone when an out-of-order day is completed', async () => {
    const { plan, settings } = await ensureSeeded();
    // Cursor is on Week 1 Day 0; the user starts Week 2 Day 3 from the Plan screen.
    const otherDay = plan.weeks[1]!.days[3]!;
    const session = await createSession(plan, otherDay, settings.weightOverrides);
    await completeSession(session);

    const updated = (await getPlan())!;
    expect(updated.currentWeek).toBe(1);
    expect(updated.currentDayIndex).toBe(0);
    expect((await db.sessions.get(session.id))?.status).toBe('completed');
  });

  it('restartBlock clears sessions even if they carry a stale plan id', async () => {
    const { plan, settings } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, settings.weightOverrides);
    await db.sessions.put({ ...session, planId: 'plan_from_an_old_install' });

    await applyResumeChoice('restartBlock');
    expect(await db.sessions.count()).toBe(0);
  });

  it('restartWeek deletes only the current week, across plan ids', async () => {
    const { plan, settings } = await ensureSeeded();
    const week1 = await createSession(plan, plan.weeks[0]!.days[0]!, settings.weightOverrides);
    const week2 = await createSession(plan, plan.weeks[1]!.days[0]!, settings.weightOverrides);
    await db.sessions.put({ ...week1, planId: 'stale' });

    await applyResumeChoice('restartWeek');

    expect(await db.sessions.get(week1.id)).toBeUndefined();
    expect(await db.sessions.get(week2.id)).toBeDefined();
  });
});

describe('session results shape', () => {
  it('the factory result matches what createSession produces', async () => {
    await reset();
    const { plan } = await ensureSeeded();
    const session = await createSession(plan, currentDay(plan)!, {});
    const sample = makeResult('standard-push-up', [{ reps: 10 }]);
    expect(Object.keys(session.results[0]!).sort()).toEqual(
      expect.arrayContaining(
        Object.keys(sample)
          .filter((k) => k !== 'tempo')
          .sort(),
      ),
    );
  });
});

describe('program updates reaching stored plans', () => {
  beforeEach(reset);

  /** Stores a hypertrophy plan as it looked before the arm finishers were added. */
  async function storeOutdatedPlan(opts: { edited: boolean }) {
    await ensureSeeded();
    const plan = (await getPlans()).find((p) => p.programId === 'hypertrophy-14wk')!;
    const old = structuredClone(plan.weeks);
    for (const week of old) {
      for (const day of week.days) {
        day.prescriptions = day.prescriptions.filter((p) => p.exerciseId !== 'cable-curl');
      }
    }
    const weeks = structuredClone(old);
    if (opts.edited) weeks[0]!.days[0]!.prescriptions[0]!.sets = 4;
    await db.plans.put({
      ...plan,
      weeks,
      builtFingerprint: fingerprint(old),
      currentWeek: 4,
      currentDayIndex: 2,
    });
    return plan.id;
  }

  const hasCurl = (plan: WorkoutPlan) =>
    plan.weeks.some((w) =>
      w.days.some((d) => d.prescriptions.some((p) => p.exerciseId === 'cable-curl')),
    );

  it('stamps a new plan with the fingerprint of the weeks it was built with', async () => {
    const plan = await createPlanFromProgram('hypertrophy-14wk');
    expect(plan.builtFingerprint).toBe(fingerprint(plan.weeks));
  });

  it('applies the updated program to an unedited plan, keeping its place and its history', async () => {
    const id = await storeOutdatedPlan({ edited: false });
    const plan = (await getPlanById(id))!;
    const day = plan.weeks[3]!.days[0]!;
    const session = await createSession(plan, day);

    expect(await syncPlansWithPrograms()).toEqual([id]);

    const after = (await getPlanById(id))!;
    expect(hasCurl(after)).toBe(true);
    expect([after.currentWeek, after.currentDayIndex]).toEqual([4, 2]);
    // The logged session still resolves against the rebuilt plan.
    const stored = await db.sessions.get(session.id);
    const rebuiltDay = after.weeks[3]!.days.find((d) => d.id === stored!.dayId)!;
    for (const result of stored!.results) {
      expect(rebuiltDay.prescriptions.some((p) => p.id === result.prescriptionId)).toBe(true);
    }
  });

  it('is a no-op the second time, so startup does not rewrite the plan on every launch', async () => {
    const id = await storeOutdatedPlan({ edited: false });
    await syncPlansWithPrograms();
    const first = (await getPlanById(id))!.updatedAt;
    expect(await syncPlansWithPrograms()).toEqual([]);
    expect((await getPlanById(id))!.updatedAt).toBe(first);
  });

  it('never silently overwrites a plan the user edited in-app', async () => {
    const id = await storeOutdatedPlan({ edited: true });
    expect(await syncPlansWithPrograms()).toEqual([]);
    const after = (await getPlanById(id))!;
    expect(hasCurl(after)).toBe(false);
    expect(after.weeks[0]!.days[0]!.prescriptions[0]!.sets).toBe(4);
  });

  it('applies the update to an edited plan once the user asks for it', async () => {
    const id = await storeOutdatedPlan({ edited: true });
    await applyProgramUpdate(id);
    const after = (await getPlanById(id))!;
    expect(hasCurl(after)).toBe(true);
    expect(after.builtFingerprint).toBe(fingerprint(after.weeks));
  });

  it('does not touch a Movement Resilience plan', async () => {
    const legacy = await createPlanFromProgram('movement-resilience');
    const before = (await getPlanById(legacy.id))!;
    await syncPlansWithPrograms();
    expect((await getPlanById(legacy.id))!.weeks).toEqual(before.weeks);
  });
});
