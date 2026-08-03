import { describe, expect, it } from 'vitest';
import { buildWeeks, DAY_TEMPLATES, PUSH_UP_EXERCISE_IDS, WARM_UP } from './program';
import { EXERCISE_BY_ID } from './exercises';
import { plannedRepsLabel } from '@/db/repository';

const weeks = buildWeeks();

describe('four-week program generation', () => {
  it('produces four weeks of five training days', () => {
    expect(weeks).toHaveLength(4);
    for (const week of weeks) {
      expect(week.days).toHaveLength(5);
      expect(week.days.map((d) => d.weekday)).toEqual([
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
      ]);
    }
  });

  it('gives every prescription a unique id', () => {
    const ids = weeks.flatMap((w) => w.days.flatMap((d) => d.prescriptions.map((p) => p.id)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('references only exercises that exist in the library', () => {
    const missing = weeks
      .flatMap((w) => w.days.flatMap((d) => d.prescriptions.map((p) => p.exerciseId)))
      .filter((id) => !EXERCISE_BY_ID[id]);
    expect(missing).toEqual([]);
  });

  it('progresses the backward treadmill finisher across the four weeks', () => {
    const minutesFor = (week: number, dayType: string) =>
      weeks
        .find((w) => w.weekNumber === week)!
        .days.find((d) => d.dayType === dayType)!
        .prescriptions.find((p) => p.exerciseId === 'backward-treadmill-walk')!.minutes;

    expect([1, 2, 3, 4].map((w) => minutesFor(w, 'upperA'))).toEqual([8, 10, 12, 15]);
    expect([1, 2, 3, 4].map((w) => minutesFor(w, 'lowerA'))).toEqual([10, 12, 12, 15]);
    expect([1, 2, 3, 4].map((w) => minutesFor(w, 'lowerB'))).toEqual([10, 12, 15, 15]);
  });

  it('raises the weekly push-up goal through weeks 1-3 and holds in week 4', () => {
    expect(weeks.map((w) => w.pushUpGoalLow)).toEqual([45, 55, 60, 60]);
    expect(weeks.map((w) => w.pushUpGoalHigh)).toEqual([60, 70, 80, 80]);
  });

  it('adds pull-up practice volume as the weeks progress', () => {
    const sets = weeks.map(
      (w) =>
        w.days
          .find((d) => d.dayType === 'upperA')!
          .prescriptions.find((p) => p.exerciseId === 'strict-pull-up')!.sets,
    );
    expect(sets).toEqual([3, 4, 4, 5]);
  });

  it('never programs a conventional deadlift or a reverse lunge', () => {
    const ids = new Set(
      weeks.flatMap((w) => w.days.flatMap((d) => d.prescriptions.map((p) => p.exerciseId))),
    );
    expect([...ids].some((id) => id.includes('reverse-lunge'))).toBe(false);
    expect(ids.has('barbell-deadlift')).toBe(false);
  });

  it('keeps the mobility day free of heavy loading', () => {
    const wednesday = weeks[0]!.days.find((d) => d.dayType === 'mobility')!;
    const loaded = wednesday.prescriptions.filter(
      (p) => EXERCISE_BY_ID[p.exerciseId]?.loadType === 'barbell',
    );
    expect(loaded).toEqual([]);
  });

  it('groups supersets so consecutive exercises share a block label', () => {
    const monday = weeks[0]!.days[0]!;
    const supersetA = monday.prescriptions.filter((p) => p.block === 'A');
    expect(supersetA).toHaveLength(2);
    expect(supersetA[0]!.restSeconds).toBe(0); // rest only after the pair
    expect(supersetA[1]!.restSeconds).toBeGreaterThan(0);
  });

  it('keeps each session inside the ~60 minute target', () => {
    for (const week of weeks) {
      for (const day of week.days) {
        expect(day.estimatedMinutes).toBeLessThanOrEqual(60);
      }
    }
  });

  it('has one canonical template per weekday driving all four weeks', () => {
    expect(DAY_TEMPLATES).toHaveLength(5);
  });
});

describe('warm-up', () => {
  it('has the eight prescribed movements and is separate from the workout', () => {
    expect(WARM_UP).toHaveLength(8);
    expect(WARM_UP[0]!.label).toMatch(/treadmill walk — 5 min/);
    const allPrescribed = weeks.flatMap((w) =>
      w.days.flatMap((d) => d.prescriptions.map((p) => p.id)),
    );
    expect(allPrescribed.some((id) => id.includes('wu-'))).toBe(false);
  });
});

describe('plannedRepsLabel', () => {
  it('formats a rep range', () => {
    expect(plannedRepsLabel({ repsLow: 8, repsHigh: 12, perSide: false })).toBe('8-12');
  });

  it('formats a fixed rep count per side', () => {
    expect(plannedRepsLabel({ repsLow: 5, repsHigh: 5, perSide: true })).toBe('5 per side');
  });

  it('formats a hold', () => {
    expect(
      plannedRepsLabel({ durationSecondsLow: 20, durationSecondsHigh: 45, perSide: false }),
    ).toBe('20-45s');
  });

  it('formats treadmill minutes', () => {
    expect(plannedRepsLabel({ minutes: 12, perSide: false })).toBe('12 min');
  });
});

describe('push-up variations', () => {
  it('counts standard, decline and pike variants', () => {
    expect(PUSH_UP_EXERCISE_IDS).toContain('standard-push-up');
    expect(PUSH_UP_EXERCISE_IDS).toContain('decline-push-up');
    expect(PUSH_UP_EXERCISE_IDS).toContain('pike-push-up');
  });
});
