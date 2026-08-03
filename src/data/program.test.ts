import { describe, expect, it } from 'vitest';
import {
  buildWeeks,
  DAY_TEMPLATES,
  estimateSessionMinutes,
  PUSH_UP_EXERCISE_IDS,
  WARM_UP,
} from './program';
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

  it('keeps every session inside the ~60 minute target', () => {
    // estimatedMinutes is COMPUTED from the prescriptions, so this actually
    // constrains the program. A hand-written constant here hid a real overrun:
    // week 4's upper days ran to 60 and 62 minutes while declaring 60.
    for (const week of weeks) {
      for (const day of week.days) {
        expect(
          day.estimatedMinutes,
          `W${week.weekNumber} ${day.dayType} is ${day.estimatedMinutes} min`,
        ).toBeLessThanOrEqual(60);
      }
    }
  });

  it('does not let week 4 become the longest week', () => {
    // Week 4 is consolidation plus testing — it must not also peak in duration.
    const longest = weeks.map((w) => Math.max(...w.days.map((d) => d.estimatedMinutes)));
    expect(longest[3]).toBeLessThanOrEqual(58);
    expect(longest[3]! - longest[0]!).toBeLessThanOrEqual(12);
  });

  it('holds pull-up practice volume in week 4 rather than peaking', () => {
    const setsFor = (dayType: string) =>
      weeks.map(
        (w) =>
          w.days
            .find((d) => d.dayType === dayType)!
            .prescriptions.find((p) => p.exerciseId === 'strict-pull-up')!.sets,
      );
    expect(setsFor('upperA')).toEqual([3, 4, 4, 4]);
    expect(setsFor('upperB')).toEqual([3, 4, 4, 4]);
  });

  it('caps carry and hang progression instead of peaking in week 4', () => {
    const highs = (dayType: string, exerciseId: string) =>
      weeks.map(
        (w) =>
          w.days
            .find((d) => d.dayType === dayType)!
            .prescriptions.find((p) => p.exerciseId === exerciseId)!.durationSecondsHigh,
      );
    expect(highs('upperB', 'farmer-carry')).toEqual([45, 45, 50, 50]);
    expect(highs('upperA', 'dead-hang')).toEqual([40, 45, 50, 50]);
  });
});

describe('estimateSessionMinutes', () => {
  it('charges rest once per superset round, not once per exercise', () => {
    const pair = [
      { sets: 3, repsHigh: 10, restSeconds: 0, blockLabel: 'Superset A', perSide: false },
      { sets: 3, repsHigh: 10, restSeconds: 60, blockLabel: 'Superset A', perSide: false },
    ] as never[];
    // 3 rounds x (30s + 30s work + 60s rest) + 2 transitions = 420s = 7 min
    expect(estimateSessionMinutes(pair)).toBe(7);
  });

  it('treats a rest-bearing item as ending its group', () => {
    const sequential = [
      { sets: 2, repsHigh: 10, restSeconds: 60, blockLabel: 'Skill Block', perSide: false },
      { sets: 2, repsHigh: 10, restSeconds: 60, blockLabel: 'Skill Block', perSide: false },
    ] as never[];
    // Two separate groups: 2 x (2 x (30 + 60) + 30) = 420s = 7 min
    expect(estimateSessionMinutes(sequential)).toBe(7);
  });

  it('doubles per-side work', () => {
    const oneSide = [
      { sets: 1, repsHigh: 10, restSeconds: 60, blockLabel: 'A', perSide: false },
    ] as never[];
    const twoSides = [
      { sets: 1, repsHigh: 10, restSeconds: 60, blockLabel: 'A', perSide: true },
    ] as never[];
    expect(estimateSessionMinutes(twoSides)).toBeGreaterThan(estimateSessionMinutes(oneSide));
  });

  it('excludes the warm-up, which is tracked separately', () => {
    const monday = weeks[0]!.days[0]!;
    expect(monday.prescriptions.some((p) => p.id.includes('wu-'))).toBe(false);
    expect(monday.estimatedMinutes).toBe(estimateSessionMinutes(monday.prescriptions));
  });
});

describe('template structure', () => {
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

describe('seeded starting loads', () => {
  const loaded: [string, number][] = [
    ['glute-bridge', 20],
    ['hip-thrust', 60],
    ['goblet-squat', 16],
    ['standing-calf-raise', 20],
    ['supported-split-squat', 10],
    ['farmer-carry', 20],
    ['suitcase-carry', 16],
  ];

  it.each(loaded)('seeds %s at %i kg in every week', (exerciseId, weight) => {
    const found = weeks.flatMap((w) =>
      w.days.flatMap((d) => d.prescriptions.filter((p) => p.exerciseId === exerciseId)),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((p) => p.recommendedWeight === weight)).toBe(true);
  });

  it('leaves bodyweight and band movements unloaded', () => {
    const shouldBeNull = [
      'step-up',
      'sl-rdl-bodyweight',
      'hamstring-slider-curl',
      'strict-pull-up',
    ];
    for (const id of shouldBeNull) {
      const found = weeks.flatMap((w) =>
        w.days.flatMap((d) => d.prescriptions.filter((p) => p.exerciseId === id)),
      );
      expect(found.every((p) => p.recommendedWeight === null)).toBe(true);
    }
  });

  it('keeps the goblet squat to a load you can actually hold at your chest', () => {
    const goblet = weeks[0]!.days
      .flatMap((d) => d.prescriptions)
      .find((p) => p.exerciseId === 'goblet-squat')!;
    expect(goblet.recommendedWeight).toBeLessThanOrEqual(24);
  });
});
