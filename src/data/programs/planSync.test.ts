import { describe, expect, it } from 'vitest';
import { fingerprint } from '@/utils/fingerprint';
import { makePlan } from '@/test/factories';
import type { WeekPlan, WorkoutPlan } from '@/types';
import { PROGRAMS } from './index';
import { planUpdateStatus, rebuiltPlanPatch } from './planSync';

const program = PROGRAMS['hypertrophy-14wk'];
const current = program.buildWeeks({ weightUnit: 'lb' });

/**
 * The plan as a device stored it BEFORE the arm finishers were added: the same
 * build with the two new exercises taken out. This is the real situation the sync
 * exists for.
 */
function beforeArmWork(): WeekPlan[] {
  const weeks = structuredClone(current);
  for (const week of weeks) {
    for (const day of week.days) {
      day.prescriptions = day.prescriptions.filter(
        (p) => p.exerciseId !== 'cable-curl' && p.exerciseId !== 'rope-triceps-pressdown',
      );
    }
  }
  return weeks;
}

function hypertrophyPlan(overrides: Partial<WorkoutPlan> = {}): WorkoutPlan {
  return makePlan({ programId: 'hypertrophy-14wk', weeks: current, ...overrides });
}

describe('planUpdateStatus', () => {
  it('is current when the stored weeks already match the program', () => {
    expect(planUpdateStatus(hypertrophyPlan(), program, 'lb')).toBe('current');
  });

  it('is safe when the program changed and the plan was never edited', () => {
    const old = beforeArmWork();
    const plan = hypertrophyPlan({ weeks: old, builtFingerprint: fingerprint(old) });
    expect(planUpdateStatus(plan, program, 'lb')).toBe('safe');
  });

  it('is edited when the plan was changed in-app after it was built', () => {
    const old = beforeArmWork();
    const edited = structuredClone(old);
    edited[0]!.days[0]!.prescriptions[0]!.sets = 4;
    const plan = hypertrophyPlan({ weeks: edited, builtFingerprint: fingerprint(old) });
    expect(planUpdateStatus(plan, program, 'lb')).toBe('edited');
  });

  it('does not mistake an in-app edit on an up-to-date plan for a program update', () => {
    const edited = structuredClone(current);
    edited[0]!.days[0]!.prescriptions[0]!.sets = 4;
    const plan = hypertrophyPlan({ weeks: edited, builtFingerprint: fingerprint(current) });
    expect(planUpdateStatus(plan, program, 'lb')).toBe('current');
  });

  it('recognises an unstamped plan as unedited only if it matches a known shipped build', () => {
    const old = beforeArmWork();
    const known = hypertrophyPlan({ weeks: old, builtFingerprint: null });
    expect(planUpdateStatus(known, program, 'lb', [fingerprint(old)])).toBe('safe');
    // Anything else with no stamp might carry edits, so it is never applied silently.
    expect(planUpdateStatus(known, program, 'lb', ['00000000'])).toBe('edited');
  });

  it('leaves programs that are not maintained as data alone', () => {
    const resilience = makePlan();
    expect(planUpdateStatus(resilience, PROGRAMS['movement-resilience'], 'lb')).toBe('unsupported');
  });

  it('treats a unit change as a program change, since load steps follow the unit', () => {
    const plan = hypertrophyPlan({ builtFingerprint: fingerprint(current) });
    expect(planUpdateStatus(plan, program, 'kg')).toBe('safe');
  });
});

describe('rebuiltPlanPatch', () => {
  it('adds the new exercises while keeping every existing prescription id', () => {
    const old = beforeArmWork();
    const patch = rebuiltPlanPatch(hypertrophyPlan({ weeks: old }), program, 'lb');
    const ids = (weeks: WeekPlan[]) =>
      weeks.flatMap((w) => w.days.flatMap((d) => d.prescriptions.map((p) => p.id)));

    // Logged sessions find their exercises by these ids — none may move.
    expect(ids(patch.weeks)).toEqual(expect.arrayContaining(ids(old)));
    expect(ids(patch.weeks).some((id) => id.includes('cable-curl'))).toBe(true);
    expect(patch.builtFingerprint).toBe(fingerprint(patch.weeks));
  });

  it('keeps the user where they are in the block', () => {
    const plan = hypertrophyPlan({ weeks: beforeArmWork(), currentWeek: 5, currentDayIndex: 2 });
    const patch = rebuiltPlanPatch(plan, program, 'lb');
    expect([patch.currentWeek, patch.currentDayIndex]).toEqual([5, 2]);
  });

  it('clamps a cursor that a shorter program would leave pointing past the end', () => {
    const plan = hypertrophyPlan({ currentWeek: 40, currentDayIndex: 9 });
    const patch = rebuiltPlanPatch(plan, program, 'lb');
    expect([patch.currentWeek, patch.currentDayIndex]).toEqual([15, 3]);
  });
});
