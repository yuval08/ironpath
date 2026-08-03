import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  applyResumeChoice,
  completeSession,
  createSession,
  currentDay,
  defaultStartDate,
  ensureSeeded,
  getPlan,
  isPausedOn,
  projectedDate,
  recordPR,
} from './repository';
import { makeResult } from '@/test/factories';

async function reset() {
  await Promise.all([
    db.plans.clear(),
    db.sessions.clear(),
    db.settings.clear(),
    db.personalRecords.clear(),
    db.suggestions.clear(),
  ]);
}

describe('seeding', () => {
  beforeEach(reset);

  it('creates one plan, default settings and the travel pause', async () => {
    const { plan, settings } = await ensureSeeded();
    expect(plan.weeks).toHaveLength(4);
    expect(settings.weightUnit).toBe('kg');
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

describe('pause handling', () => {
  beforeEach(reset);

  it('reports a date inside the travel window as paused', async () => {
    const { plan } = await ensureSeeded();
    const year = new Date(plan.startDate).getFullYear();
    expect(isPausedOn(plan, new Date(`${year}-08-12T09:00:00`))).toBe(true);
    expect(isPausedOn(plan, new Date(`${year}-08-09T09:00:00`))).toBe(false);
    expect(isPausedOn(plan, new Date(`${year}-08-17T09:00:00`))).toBe(false);
  });

  it('pushes projected dates past an active pause', async () => {
    await ensureSeeded();
    const plan = (await getPlan())!;
    const pause = plan.pausePeriods[0]!;
    const dates = plan.weeks.flatMap((w) =>
      w.days.map((_, i) => projectedDate(plan, w.weekNumber, i)),
    );
    const inside = dates.filter((d) => d >= pause.startDate && d <= pause.endDate);
    expect(inside).toEqual([]);
  });

  it('ignores an inactive pause', async () => {
    const { plan } = await ensureSeeded();
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
    expect(session.warmUp).toHaveLength(8);
    expect(session.warmUp.every((w) => !w.completed)).toBe(true);
    const first = session.results[0]!;
    expect(first.sets).toHaveLength(first.plannedSets);
    expect(first.sets.every((s) => !s.completed)).toBe(true);
  });

  it('seeds recommended weights from the confirmed import overrides', async () => {
    const { plan } = await ensureSeeded();
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

  it('rolls into the next week after the fifth day', async () => {
    const { settings } = await ensureSeeded();
    for (let i = 0; i < 5; i += 1) {
      const plan = (await getPlan())!;
      const session = await createSession(plan, currentDay(plan)!, settings.weightOverrides);
      await completeSession(session);
    }
    const updated = (await getPlan())!;
    expect(updated.currentWeek).toBe(2);
    expect(updated.currentDayIndex).toBe(0);
  });

  it('marks the plan complete after the final day of week 4', async () => {
    await ensureSeeded();
    const plan = (await getPlan())!;
    await db.plans.put({ ...plan, currentWeek: 4, currentDayIndex: 4 });
    const ready = (await getPlan())!;
    const session = await createSession(ready, currentDay(ready)!, {});
    await completeSession(session);
    expect((await getPlan())!.completedAt).not.toBeNull();
  });
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

  it('restartBlock clears every session and returns to week 1 with a bumped restart count', async () => {
    const { settings } = await ensureSeeded();
    for (let i = 0; i < 6; i += 1) {
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
