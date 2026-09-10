import { describe, expect, it } from 'vitest';
import type { ExercisePrescription, WeekPlan } from '@/types';
import {
  DEFAULT_PROGRAM_ID,
  PROGRAMS,
  estimateSessionMinutes,
  programFor,
  supersetGroups,
} from './programs';
import {
  DAY_TEMPLATES as RESILIENCE_TEMPLATES,
  PUSH_UP_EXERCISE_IDS,
  WARM_UP,
  buildWeeks as buildResilienceWeeks,
} from './programs/movementResilience';
import {
  dayTemplates as hypertrophyTemplates,
  buildWeeks as buildHypertrophyWeeks,
  HYPERTROPHY_TIMING,
} from './programs/hypertrophy14';
import { EXERCISE_BY_ID } from './exercises';
import { plannedRepsLabel } from '@/db/repository';

/** Any step table works for shape assertions; the values are unit-specific. */
const STEP_SAMPLE = { dumbbell: 5, cable: 5, stack: 10, legPress: 25 };

const weeks = buildResilienceWeeks();
const hypertrophyWeeks = PROGRAMS['hypertrophy-14wk'].buildWeeks();

const allPrescriptions = (ws: WeekPlan[]): ExercisePrescription[] =>
  ws.flatMap((w) => w.days.flatMap((d) => d.prescriptions));

/** Working sets per week, keyed by exercise id, for one representative week. */
function setsByExercise(week: WeekPlan): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const day of week.days) {
    for (const p of day.prescriptions) {
      totals[p.exerciseId] = (totals[p.exerciseId] ?? 0) + p.sets;
    }
  }
  return totals;
}

describe('program registry', () => {
  it('registers both programs under their own ids', () => {
    expect(Object.keys(PROGRAMS).sort()).toEqual(['hypertrophy-14wk', 'movement-resilience']);
    for (const [id, program] of Object.entries(PROGRAMS)) {
      expect(program.id).toBe(id);
    }
  });

  it('defaults new plans to the hypertrophy block', () => {
    expect(DEFAULT_PROGRAM_ID).toBe('hypertrophy-14wk');
  });

  it('falls back to movement-resilience rather than throwing on an unknown id', () => {
    // A v1 row that reaches here without a programId is real history; rendering
    // it as the block it was written for beats refusing to render it.
    expect(programFor('nonsense' as never).id).toBe('movement-resilience');
  });

  it('reports a week and day count matching what it actually builds', () => {
    for (const program of Object.values(PROGRAMS)) {
      const built = program.buildWeeks();
      expect(built).toHaveLength(program.weekCount);
      for (const week of built) {
        expect(week.days).toHaveLength(program.daysPerWeek);
      }
    }
  });

  it('references only exercises that exist in the library', () => {
    for (const program of Object.values(PROGRAMS)) {
      const missing = allPrescriptions(program.buildWeeks())
        .map((p) => p.exerciseId)
        .filter((id) => !EXERCISE_BY_ID[id]);
      expect(missing, program.id).toEqual([]);
    }
  });

  it('gives every prescription a unique id within its program', () => {
    for (const program of Object.values(PROGRAMS)) {
      const ids = allPrescriptions(program.buildWeeks()).map((p) => p.id);
      expect(new Set(ids).size, program.id).toBe(ids.length);
    }
  });

  it('offers only substitutions that exist in the library', () => {
    for (const program of Object.values(PROGRAMS)) {
      const missing = allPrescriptions(program.buildWeeks())
        .flatMap((p) => p.substitutionIds)
        .filter((id) => !EXERCISE_BY_ID[id]);
      expect(missing, program.id).toEqual([]);
    }
  });

  it('mints day and prescription ids that no other program can collide with', () => {
    // Sessions are looked up by bare `dayId`. Two programs both owning a
    // `w1-upperA` would hand back the wrong program's session — real data
    // corruption once a user has a plan from each.
    const idsOf = (programId: 'movement-resilience' | 'hypertrophy-14wk') => {
      const built = PROGRAMS[programId].buildWeeks();
      return {
        days: new Set(built.flatMap((w) => w.days.map((d) => d.id))),
        prescriptions: new Set(allPrescriptions(built).map((p) => p.id)),
      };
    };
    const resilience = idsOf('movement-resilience');
    const hypertrophy = idsOf('hypertrophy-14wk');

    expect([...hypertrophy.days].filter((id) => resilience.days.has(id))).toEqual([]);
    expect([...hypertrophy.prescriptions].filter((id) => resilience.prescriptions.has(id))).toEqual(
      [],
    );
  });

  it('never programs a deadlift variation in any program', () => {
    for (const program of Object.values(PROGRAMS)) {
      const offenders = allPrescriptions(program.buildWeeks())
        .map((p) => p.exerciseId)
        .filter((id) => /deadlift|rdl/i.test(id) && id !== 'sl-rdl-bodyweight');
      expect(offenders, program.id).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Movement & Joint Resilience                                         */
/* ------------------------------------------------------------------ */

describe('movement resilience: four-week program generation', () => {
  it('produces four base weeks of five training days', () => {
    expect(weeks).toHaveLength(4);
    for (const week of weeks) {
      expect(week.phase).toBe('base');
      expect(week.blockWeek).toBeNull();
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

  it('progresses reps and time rather than load, so nothing is double-progressed', () => {
    const types = new Set(allPrescriptions(weeks).map((p) => p.progressionType));
    expect([...types].sort()).toEqual(['fixed', 'reps', 'time']);
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

  it('never programs a reverse lunge', () => {
    const ids = new Set(allPrescriptions(weeks).map((p) => p.exerciseId));
    expect([...ids].some((id) => id.includes('reverse-lunge'))).toBe(false);
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

  it('has one canonical template per weekday driving all four weeks', () => {
    expect(RESILIENCE_TEMPLATES).toHaveLength(5);
  });
});

describe('movement resilience: warm-up', () => {
  it('has the eight prescribed movements and is separate from the workout', () => {
    expect(WARM_UP).toHaveLength(8);
    expect(WARM_UP[0]!.label).toMatch(/treadmill walk — 5 min/);
    expect(allPrescriptions(weeks).some((p) => p.id.includes('wu-'))).toBe(false);
  });
});

describe('movement resilience: seeded starting loads', () => {
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
    const found = allPrescriptions(weeks).filter((p) => p.exerciseId === exerciseId);
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
      const found = allPrescriptions(weeks).filter((p) => p.exerciseId === id);
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

/* ------------------------------------------------------------------ */
/* 14-Week Hypertrophy                                                 */
/* ------------------------------------------------------------------ */

describe('hypertrophy 14: week structure', () => {
  it('stores 15 weeks: 2 reload, 12 hypertrophy, 1 deload', () => {
    expect(hypertrophyWeeks).toHaveLength(15);
    expect(hypertrophyWeeks.map((w) => w.phase)).toEqual([
      'reload',
      'reload',
      ...Array<string>(12).fill('hypertrophy'),
      'deload',
    ]);
  });

  it('numbers weeks 1-15 and the hypertrophy block 1-12', () => {
    expect(hypertrophyWeeks.map((w) => w.weekNumber)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
    expect(hypertrophyWeeks.map((w) => w.blockWeek)).toEqual([
      null,
      null,
      ...Array.from({ length: 12 }, (_, i) => i + 1),
      null,
    ]);
  });

  it('titles the weeks exactly as the program prescribes', () => {
    expect(hypertrophyWeeks[0]!.title).toBe('Reload Week 1 — Technique & Load Reintroduction');
    expect(hypertrophyWeeks[1]!.title).toBe('Reload Week 2 — Establish Starting Loads');
    expect(hypertrophyWeeks[2]!.title).toBe('Hypertrophy Week 1');
    expect(hypertrophyWeeks[13]!.title).toBe('Hypertrophy Week 12');
    expect(hypertrophyWeeks[14]!.title).toBe('Deload Week — Recover & Reset');
  });

  it('runs four weekday-mapped days built from one canonical template', () => {
    expect(hypertrophyTemplates(STEP_SAMPLE)).toHaveLength(4);
    for (const week of hypertrophyWeeks) {
      expect(week.days.map((d) => d.weekday)).toEqual(['monday', 'tuesday', 'thursday', 'friday']);
      expect(week.days.map((d) => d.dayType)).toEqual(['upperA', 'lowerA', 'upperB', 'lowerB']);
    }
  });

  it('prefixes every id with the program so nothing collides with the other plan', () => {
    for (const week of hypertrophyWeeks) {
      for (const day of week.days) {
        expect(day.id).toBe(`h14-w${week.weekNumber}-${day.dayType}`);
        for (const p of day.prescriptions) {
          expect(p.id.startsWith(`${day.id}-`)).toBe(true);
        }
      }
    }
  });

  it('does the general warm-up outside the app', () => {
    expect(PROGRAMS['hypertrophy-14wk'].warmUp).toEqual([]);
  });

  it('states the RIR rule in every phase, and the band hold in reload week 1', () => {
    for (const week of hypertrophyWeeks) {
      expect(week.guidance.join(' '), week.title).toMatch(/reps in reserve|RIR/i);
    }
    expect(hypertrophyWeeks[0]!.guidance.join(' ')).toMatch(
      /do not reduce band assistance this week/i,
    );
  });
});

describe('hypertrophy 14: phase scaling', () => {
  const reload1 = hypertrophyWeeks[0]!;
  const reload2 = hypertrophyWeeks[1]!;
  const hypertrophy = hypertrophyWeeks[2]!;
  const deload = hypertrophyWeeks[14]!;

  it('caps reload week 1 and the deload at 2 sets of everything', () => {
    for (const week of [reload1, deload]) {
      const over = allPrescriptions([week]).filter((p) => p.sets > 2);
      expect(
        over.map((p) => p.exerciseId),
        week.title,
      ).toEqual([]);
    }
  });

  it('restores full main-lift sets in reload week 2 but caps accessories at 3', () => {
    const byId = setsByExercise(reload2);
    expect(byId['incline-dumbbell-press']).toBe(5); // main, full
    expect(byId['flat-dumbbell-press']).toBe(5); // main, full
    expect(byId['seated-leg-curl']).toBe(6); // accessory 4+4 capped to 3+3
  });

  it('runs full template volume in every hypertrophy week', () => {
    const reference = setsByExercise(hypertrophy);
    for (const week of hypertrophyWeeks.filter((w) => w.phase === 'hypertrophy')) {
      expect(setsByExercise(week), week.title).toEqual(reference);
    }
  });

  it('targets RIR 3 in reload week 1 and the deload, 2-3 in reload week 2, 1-2 in the block', () => {
    const rir = (week: WeekPlan) =>
      new Set(
        allPrescriptions([week])
          .filter((p) => p.targetRirLow != null)
          .map((p) => `${p.targetRirLow}-${p.targetRirHigh}`),
      );
    expect([...rir(reload1)]).toEqual(['3-3']);
    expect([...rir(deload)]).toEqual(['3-3']);
    expect([...rir(reload2)]).toEqual(['2-3']);
    expect([...rir(hypertrophy)].sort()).toEqual(['1-2', '2-2', '2-3']);
  });

  it('never gives a target RIR to prep or rep-progressed finishers', () => {
    const noRir = ['scapular-pull-up', 'tibialis-raise', 'captains-chair-leg-raise'];
    for (const week of hypertrophyWeeks) {
      for (const p of allPrescriptions([week]).filter((x) => noRir.includes(x.exerciseId))) {
        expect(p.targetRirLow, `${week.title} ${p.exerciseId}`).toBeNull();
        expect(p.targetRirHigh).toBeNull();
      }
    }
  });

  it('suppresses ramp sets in reload week 1 and offers them from reload week 2 on', () => {
    expect(allPrescriptions([reload1]).every((p) => p.rampSets === 0)).toBe(true);
    for (const week of [reload2, hypertrophy, deload]) {
      const ramped = allPrescriptions([week]).filter((p) => p.rampSets > 0);
      expect(ramped.map((p) => p.exerciseId).sort(), week.title).toEqual([
        'incline-dumbbell-press',
        'leg-press',
        'seated-dumbbell-shoulder-press',
        'smith-machine-squat',
      ]);
    }
  });
});

describe('hypertrophy 14: safety constraints', () => {
  const ids = allPrescriptions(hypertrophyWeeks).map((p) => p.exerciseId);

  it('contains no deadlift, RDL, stiff-leg or trap-bar movement anywhere', () => {
    expect(ids.filter((id) => /deadlift|rdl|stiff-leg|trap-bar/i.test(id))).toEqual([]);
  });

  it('never prescribes a strict pull-up or a chin-up', () => {
    expect(ids.filter((id) => id === 'strict-pull-up' || id === 'chin-up')).toEqual([]);
  });

  it('never prescribes a hanging leg raise', () => {
    expect(ids.filter((id) => id.includes('hanging'))).toEqual([]);
  });

  it('never supersets the two heavy compounds', () => {
    const heavy = allPrescriptions(hypertrophyWeeks).filter((p) =>
      ['smith-machine-squat', 'leg-press'].includes(p.exerciseId),
    );
    expect(heavy.length).toBeGreaterThan(0);
    expect(heavy.every((p) => p.supersetKey === undefined)).toBe(true);
  });

  it('marks the split squat optional as the documented first cut', () => {
    const splits = allPrescriptions(hypertrophyWeeks).filter(
      (p) => p.exerciseId === 'supported-split-squat',
    );
    expect(splits.length).toBe(hypertrophyWeeks.length);
    expect(splits.every((p) => p.optional)).toBe(true);
    expect(splits[0]!.notes).toMatch(/55 minutes/);
    expect(splits.every((p) => p.perSide && p.entryStyle === 'repsPerSide')).toBe(true);
  });

  it('progresses the pull-up by band, never by load', () => {
    const pullUps = allPrescriptions(hypertrophyWeeks).filter(
      (p) => p.exerciseId === 'band-assisted-pull-up',
    );
    expect(pullUps.every((p) => p.progressionType === 'bandAssist')).toBe(true);
    expect(pullUps.every((p) => p.weightIncrement === null)).toBe(true);
  });

  it('gives every double-progression prescription a usable load step', () => {
    const doubles = allPrescriptions(hypertrophyWeeks).filter(
      (p) => p.progressionType === 'double',
    );
    expect(doubles.length).toBeGreaterThan(0);
    expect(doubles.every((p) => (p.weightIncrement ?? 0) > 0)).toBe(true);
  });
});

describe('hypertrophy 14: superset wiring', () => {
  it('rests only after the final member of every superset group', () => {
    for (const week of hypertrophyWeeks) {
      for (const day of week.days) {
        const groups = new Map<string, ExercisePrescription[]>();
        for (const p of day.prescriptions) {
          if (p.supersetKey == null) continue;
          const list = groups.get(p.supersetKey) ?? [];
          list.push(p);
          groups.set(p.supersetKey, list);
        }
        expect(groups.size).toBeGreaterThan(0);
        for (const [key, members] of groups) {
          expect(members.length, key).toBeGreaterThan(1);
          for (const p of members.slice(0, -1)) {
            expect(p.restSeconds, `${week.title} ${key} ${p.slot}`).toBe(0);
          }
          expect(members[members.length - 1]!.restSeconds, key).toBeGreaterThan(0);
        }
      }
    }
  });

  it('labels every superset member with its slot', () => {
    const members = allPrescriptions(hypertrophyWeeks).filter((p) => p.supersetKey != null);
    expect(members.every((p) => /^[ABC][12]$/.test(p.slot ?? ''))).toBe(true);
  });

  it('pairs only the rounds both members share, leaving the rest straight', () => {
    // Paired rounds are DERIVED as min(sets) — there is no field for it.
    const monday = hypertrophyWeeks[2]!.days[0]!;
    const groupA = monday.prescriptions.filter((p) => p.supersetKey === 'upperA-A');
    expect(groupA.map((p) => p.sets)).toEqual([3, 5]);
    expect(Math.min(...groupA.map((p) => p.sets))).toBe(3);
  });
});

describe('hypertrophy 14: weekly volume', () => {
  /** Working sets that actually count toward each muscle. */
  const MUSCLES: Record<string, string[]> = {
    chest: ['incline-dumbbell-press', 'flat-dumbbell-press'],
    // Scapular pull-ups are prep, not back volume, so they are excluded.
    back: ['band-assisted-pull-up', 'chest-supported-row', 'neutral-grip-lat-pulldown'],
    lateralDelts: ['cable-lateral-raise'],
    quads: ['smith-machine-squat', 'leg-extension', 'leg-press', 'supported-split-squat'],
    hamstrings: ['seated-leg-curl'],
    calves: ['standing-calf-raise'],
    tibialis: ['tibialis-raise'],
    abs: ['cable-crunch', 'captains-chair-leg-raise'],
  };

  const block = hypertrophyWeeks[2]!;
  const totals = setsByExercise(block);
  const volume = (muscle: string) =>
    MUSCLES[muscle]!.reduce((sum, id) => sum + (totals[id] ?? 0), 0);

  it('hits the prescribed weekly working sets per muscle', () => {
    expect(volume('chest')).toBe(10);
    expect(volume('back')).toBe(12);
    expect(volume('lateralDelts')).toBe(6);
    expect(volume('hamstrings')).toBe(8);
    expect(volume('calves')).toBe(6);
    expect(volume('tibialis')).toBe(4);
    expect(volume('abs')).toBe(6);
  });

  it('lands quad volume inside the prescribed 10-11 set band', () => {
    expect(volume('quads')).toBe(11);
    expect(volume('quads')).toBeGreaterThanOrEqual(10);
    expect(volume('quads')).toBeLessThanOrEqual(11);
    // The split squat is the optional cut; it is the only quad work that moves.
    expect(totals['supported-split-squat']).toBe(2);
  });

  it('puts abs on both upper days', () => {
    const absDays = block.days.filter((d) =>
      d.prescriptions.some((p) => MUSCLES['abs']!.includes(p.exerciseId)),
    );
    expect(absDays.map((d) => d.dayType)).toEqual(['upperA', 'upperB']);
  });

  it('programs no direct arm work at launch', () => {
    const armIds = /curl|triceps|pushdown|skull|kickback|preacher/i;
    const arms = allPrescriptions(hypertrophyWeeks)
      .map((p) => p.exerciseId)
      // Leg curls are hamstrings, not arms.
      .filter((id) => armIds.test(id) && !id.includes('leg-curl'));
    expect([...new Set(arms)]).toEqual([]);
  });
});

describe('hypertrophy 14: session length', () => {
  it('keeps every day in every phase inside the 55 minute ceiling', () => {
    for (const week of hypertrophyWeeks) {
      for (const day of week.days) {
        expect(
          day.estimatedMinutes,
          `${week.title} ${day.dayType} is ${day.estimatedMinutes} min`,
        ).toBeLessThanOrEqual(55);
      }
    }
  });

  it('computes estimatedMinutes from the prescriptions rather than hard-coding it', () => {
    for (const week of hypertrophyWeeks) {
      for (const day of week.days) {
        expect(day.estimatedMinutes).toBe(
          estimateSessionMinutes(day.prescriptions, HYPERTROPHY_TIMING),
        );
      }
    }
  });

  it('leaves the full hypertrophy weeks long enough to be worth the trip', () => {
    // Guards a hollowed-out block at the real 4 s/rep scale: a full day that
    // estimates under 40 min has lost volume somewhere.
    const block = hypertrophyWeeks[2]!;
    for (const day of block.days) {
      expect(day.estimatedMinutes, day.dayType).toBeGreaterThanOrEqual(40);
    }
  });

  it('paces the two programs differently, on purpose', () => {
    // The same day costed at the resilience block's 3 s/rep reads materially
    // shorter. If these ever match, someone has unified the constant and the
    // displayed target has silently moved.
    const day = hypertrophyWeeks[2]!.days[0]!;
    expect(estimateSessionMinutes(day.prescriptions)).toBeLessThan(day.estimatedMinutes);
  });
});

/* ------------------------------------------------------------------ */
/* Shared timing model                                                 */
/* ------------------------------------------------------------------ */

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

  it('charges ramp sets once per group, not once per round', () => {
    const base = [
      { sets: 3, repsHigh: 10, restSeconds: 90, blockLabel: 'A', perSide: false, rampSets: 0 },
    ] as never[];
    const ramped = [
      { sets: 3, repsHigh: 10, restSeconds: 90, blockLabel: 'A', perSide: false, rampSets: 2 },
    ] as never[];
    // 3 x (30 + 90) + 30 = 390s; + 2 ramp sets x 25s = 440s. 7 min -> 7 min.
    expect(estimateSessionMinutes(base)).toBe(7);
    expect(estimateSessionMinutes(ramped)).toBe(7);
    // The seconds are really added, they just round the same at this size.
    const many = [
      { sets: 3, repsHigh: 10, restSeconds: 90, blockLabel: 'A', perSide: false, rampSets: 6 },
    ] as never[];
    expect(estimateSessionMinutes(many)).toBe(9);
  });

  it('excludes the warm-up, which is tracked separately', () => {
    const monday = weeks[0]!.days[0]!;
    expect(monday.prescriptions.some((p) => p.id.includes('wu-'))).toBe(false);
    expect(monday.estimatedMinutes).toBe(estimateSessionMinutes(monday.prescriptions));
  });
});

describe('supersetGroups', () => {
  it('splits on supersetKey when one is present, ignoring the shared block label', () => {
    const day = hypertrophyWeeks[2]!.days[0]!;
    const groups = supersetGroups(day.prescriptions);
    expect(groups.map((g) => g.map((p) => p.slot ?? '-'))).toEqual([
      ['-'],
      ['A1', 'A2'],
      ['B1', 'B2'],
      ['-'],
      ['-'],
    ]);
  });
});

/* ------------------------------------------------------------------ */

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

describe('load steps follow the unit the plan was created in', () => {
  /**
   * `weightUnit` only relabels — nothing converts stored weights — so a plan built
   * in lb must carry real lb jumps. Suggesting +2 on a dumbbell press to someone
   * training in pounds is a step that does not exist on the rack.
   */
  it('uses real plate jumps in each unit', () => {
    const inLb = buildHypertrophyWeeks({ weightUnit: 'lb' });
    const inKg = buildHypertrophyWeeks({ weightUnit: 'kg' });

    const stepFor = (weeks: ReturnType<typeof buildHypertrophyWeeks>, exerciseId: string) =>
      weeks[0]?.days.flatMap((d) => d.prescriptions).find((p) => p.exerciseId === exerciseId)
        ?.weightIncrement;

    expect(stepFor(inLb, 'incline-dumbbell-press')).toBe(5);
    expect(stepFor(inKg, 'incline-dumbbell-press')).toBe(2);
    expect(stepFor(inLb, 'seated-leg-curl')).toBe(10);
    expect(stepFor(inKg, 'seated-leg-curl')).toBe(5);
  });

  it('defaults to lb, the unit the app ships in', () => {
    const stepped = buildHypertrophyWeeks()[0]
      ?.days.flatMap((d) => d.prescriptions)
      .find((p) => p.exerciseId === 'incline-dumbbell-press');
    expect(stepped?.weightIncrement).toBe(5);
  });
});
