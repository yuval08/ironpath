import { describe, expect, it } from 'vitest';
import { makeResult, makeSession, makeSet } from '@/test/factories';
import { DEFAULT_BAND_LABELS } from '@/types';
import type { ExercisePrescription } from '@/types';
import {
  BAND_LADDER,
  bandName,
  evaluateDoubleProgression,
  formatPerformance,
  lastPerformance,
  nextLighterBand,
  performanceHistory,
  previousResult,
  progressionReps,
  rampSetsOf,
  recentPerformances,
  setHint,
  snapshotFor,
  workingSets,
} from './doubleProgression';

function presc(overrides: Partial<ExercisePrescription> = {}): ExercisePrescription {
  return {
    id: 'presc_1',
    exerciseId: 'incline-dumbbell-press',
    block: 'A',
    blockLabel: 'Superset A',
    order: 1,
    sets: 3,
    repsLow: 6,
    repsHigh: 10,
    perSide: false,
    restSeconds: 90,
    recommendedWeight: 30,
    entryStyle: 'reps',
    substitutionIds: [],
    optional: false,
    role: 'main',
    progressionType: 'double',
    targetRirLow: 1,
    targetRirHigh: 2,
    weightIncrement: 2,
    rampSets: 0,
    ...overrides,
  };
}

const topOfRange = () =>
  makeResult('incline-dumbbell-press', [
    { reps: 10, weight: 30, rir: 2 },
    { reps: 10, weight: 30, rir: 1 },
    { reps: 10, weight: 30, rir: 1 },
  ]);

describe('BAND_LADDER / nextLighterBand', () => {
  it('runs from most to least assistance', () => {
    expect(BAND_LADDER).toEqual(['extraHeavy', 'heavy', 'medium', 'light', 'extraLight', 'none']);
  });

  it('steps one rung lighter', () => {
    expect(nextLighterBand('extraHeavy')).toBe('heavy');
    expect(nextLighterBand('medium')).toBe('light');
    expect(nextLighterBand('extraLight')).toBe('none');
  });

  it('has nowhere to go from unassisted', () => {
    expect(nextLighterBand('none')).toBeNull();
  });
});

describe('workingSets / rampSetsOf', () => {
  const result = makeResult('smith-machine-squat', [
    { reps: 5, weight: 40, isWarmUp: true },
    { reps: 3, weight: 60, isWarmUp: true },
    { reps: 8, weight: 80 },
    { reps: 8, weight: 80 },
  ]);

  it('splits ramp sets from working sets', () => {
    expect(workingSets(result).map((s) => s.weight)).toEqual([80, 80]);
    expect(rampSetsOf(result).map((s) => s.weight)).toEqual([40, 60]);
  });
});

describe('progressionReps', () => {
  it('uses the plain rep count', () => {
    expect(progressionReps(makeSet({ reps: 12 }))).toBe(12);
  });

  it('counts a per-side set as its weaker side', () => {
    expect(progressionReps(makeSet({ repsLeft: 12, repsRight: 9 }))).toBe(9);
  });

  it('treats a missing side as zero rather than ignoring it', () => {
    expect(progressionReps(makeSet({ repsLeft: 10 }))).toBe(0);
  });

  it('is 0 when nothing was logged', () => {
    expect(progressionReps(makeSet())).toBe(0);
  });
});

describe('snapshots and history', () => {
  const session = makeSession({
    date: '2026-08-03',
    results: [
      makeResult('incline-dumbbell-press', [
        { reps: 5, weight: 20, isWarmUp: true },
        { reps: 10, weight: 32, rir: 2 },
        { reps: 9, weight: 32, rir: 1 },
        { reps: 8, weight: 32, rir: 1 },
      ]),
    ],
  });

  it('reads the working sets only', () => {
    const snap = snapshotFor(session, session.results[0]!);
    expect(snap).toMatchObject({
      date: '2026-08-03',
      weight: 32,
      band: null,
      reps: [10, 9, 8],
      rir: [2, 1, 1],
    });
    // The per-set record carries the same working sets, and no ramp set.
    expect(snap.sets.map((s) => s.reps)).toEqual([10, 9, 8]);
    expect(snap.sets.some((s) => s.isWarmUp)).toBe(false);
  });

  it('returns history oldest first and lastPerformance as the newest', () => {
    const later = makeSession({
      date: '2026-08-10',
      results: [makeResult('incline-dumbbell-press', [{ reps: 10, weight: 34 }])],
    });
    const history = performanceHistory([later, session], 'incline-dumbbell-press');
    expect(history.map((h) => h.date)).toEqual(['2026-08-03', '2026-08-10']);
    expect(lastPerformance([later, session], 'incline-dumbbell-press')?.weight).toBe(34);
  });

  it('credits the substituted exercise, not the slot it replaced', () => {
    const substituted = makeSession({
      results: [
        makeResult('incline-dumbbell-press', [{ reps: 10, weight: 40 }], {
          substitutionExerciseId: 'incline-smith-press',
        }),
      ],
    });
    expect(lastPerformance([substituted], 'incline-dumbbell-press')).toBeNull();
    expect(lastPerformance([substituted], 'incline-smith-press')?.weight).toBe(40);
  });

  it('ignores skipped exercises', () => {
    const skipped = makeSession({
      results: [
        makeResult('incline-dumbbell-press', [{ reps: 10, weight: 40 }], {
          skippedReason: 'Shoulder',
        }),
      ],
    });
    expect(lastPerformance([skipped], 'incline-dumbbell-press')).toBeNull();
  });

  it('has no history at all for an untouched exercise', () => {
    expect(lastPerformance([session], 'leg-press')).toBeNull();
  });
});

describe('formatPerformance', () => {
  it('formats weight, reps and RIR', () => {
    const snap = {
      date: '2026-08-03',
      weight: 32,
      band: null,
      reps: [10, 9, 8],
      rir: [2, 1, 1],
      sets: [],
    };
    expect(formatPerformance(snap, 'kg')).toBe('32 kg · 10 / 9 / 8 · RIR 2 / 1 / 1');
  });

  it('omits the RIR clause when none was recorded', () => {
    const snap = {
      date: '2026-08-03',
      weight: null,
      band: 'medium' as const,
      reps: [9, 8, 8],
      rir: [null, null, null],
      sets: [],
    };
    expect(formatPerformance(snap, 'kg')).toBe('Medium band · 9 / 8 / 8');
  });

  it('honours user band labels', () => {
    const snap = {
      date: '2026-08-03',
      weight: null,
      band: 'heavy' as const,
      reps: [6],
      rir: [],
      sets: [],
    };
    expect(
      formatPerformance(snap, 'kg', {
        extraHeavy: 'Black',
        heavy: 'Red',
        medium: 'Green',
        light: 'Purple',
        extraLight: 'Orange',
        none: 'None',
      }),
    ).toBe('Red band · 6');
  });

  it('resolves named bands from a partial map and the rest from the defaults', () => {
    // The user only owns (and only renamed) two of the six bands.
    const partial = { heavy: 'Red', medium: 'Green' };
    const snap = (band: 'heavy' | 'light') => ({
      date: '2026-08-03',
      weight: null,
      band,
      reps: [8],
      rir: [],
      sets: [],
    });
    expect(formatPerformance(snap('heavy'), 'kg', partial)).toBe('Red band · 8');
    expect(formatPerformance(snap('light'), 'kg', partial)).toBe('Light band · 8');
  });

  it('says bodyweight rather than "No band band"', () => {
    const snap = {
      date: 'x',
      weight: null,
      band: 'none' as const,
      reps: [7, 6],
      rir: [],
      sets: [],
    };
    expect(formatPerformance(snap, 'kg')).toBe('Bodyweight · 7 / 6');
  });

  it('reports no history for a null snapshot', () => {
    expect(formatPerformance(null, 'kg')).toBe('No history yet');
  });
});

describe('bandName', () => {
  it('uses the user label when they named that band', () => {
    expect(bandName('medium', { medium: 'Green' })).toBe('Green');
  });

  it('falls back to the default label for a band they did not name', () => {
    expect(bandName('medium', { heavy: 'Red' })).toBe(DEFAULT_BAND_LABELS.medium);
    expect(bandName('light', {})).toBe(DEFAULT_BAND_LABELS.light);
  });

  it('uses the defaults when no labels are supplied at all', () => {
    expect(bandName('none')).toBe(DEFAULT_BAND_LABELS.none);
  });
});

describe('evaluateDoubleProgression — weight', () => {
  it('is ready when every working set owns the top of the range', () => {
    const verdict = evaluateDoubleProgression(presc(), topOfRange());
    expect(verdict.status).toBe('ready');
    expect(verdict.kind).toBe('weight');
    expect(verdict.message).toContain('Ready to increase load next session');
    expect(verdict.suggestedWeight).toBe(32);
    expect(verdict.suggestedBand).toBeNull();
  });

  it('holds when one set fell short of the top of the range', () => {
    const result = makeResult('incline-dumbbell-press', [
      { reps: 10, weight: 30 },
      { reps: 10, weight: 30 },
      { reps: 9, weight: 30 },
    ]);
    const verdict = evaluateDoubleProgression(presc(), result);
    expect(verdict.status).toBe('hold');
    expect(verdict.suggestedWeight).toBeNull();
  });

  it('holds when fewer working sets were logged than prescribed', () => {
    const result = makeResult('incline-dumbbell-press', [
      { reps: 10, weight: 30 },
      { reps: 10, weight: 30 },
    ]);
    expect(evaluateDoubleProgression(presc(), result).status).toBe('hold');
  });

  it('holds when a working set was left incomplete', () => {
    const result = makeResult('incline-dumbbell-press', [
      { reps: 10, weight: 30 },
      { reps: 10, weight: 30 },
      { reps: 10, weight: 30, completed: false },
    ]);
    expect(evaluateDoubleProgression(presc(), result).status).toBe('hold');
  });

  it('holds when form broke down, and when the exercise was skipped', () => {
    const badForm = makeResult(
      'incline-dumbbell-press',
      [
        { reps: 10, weight: 30 },
        { reps: 10, weight: 30 },
        { reps: 10, weight: 30 },
      ],
      { formGood: false },
    );
    expect(evaluateDoubleProgression(presc(), badForm).status).toBe('hold');
    const skipped = { ...topOfRange(), skippedReason: 'Shoulder' };
    expect(evaluateDoubleProgression(presc(), skipped).status).toBe('hold');
  });

  it('reports noData with no result, and for non-double prescriptions', () => {
    expect(evaluateDoubleProgression(presc(), null).status).toBe('noData');
    expect(evaluateDoubleProgression(presc(), undefined).kind).toBe('weight');
    const fixed = presc({ progressionType: 'fixed' });
    expect(evaluateDoubleProgression(fixed, topOfRange())).toMatchObject({
      status: 'noData',
      kind: 'none',
    });
    expect(evaluateDoubleProgression(presc({ progressionType: 'reps' }), topOfRange()).status).toBe(
      'noData',
    );
  });

  it('reports noData when the prescription has no top of range to hit', () => {
    expect(evaluateDoubleProgression(presc({ repsHigh: undefined }), topOfRange()).status).toBe(
      'noData',
    );
  });

  it('ignores ramp sets in both the count and the rep check', () => {
    const withRamp = makeResult('incline-dumbbell-press', [
      { reps: 5, weight: 15, isWarmUp: true },
      { reps: 3, weight: 22, isWarmUp: true },
      { reps: 10, weight: 30 },
      { reps: 10, weight: 30 },
      { reps: 10, weight: 30 },
    ]);
    const verdict = evaluateDoubleProgression(presc(), withRamp);
    expect(verdict.status).toBe('ready');
    // The 22 kg ramp must not be mistaken for the working load.
    expect(verdict.suggestedWeight).toBe(32);
  });

  it('suggests no weight when none was logged', () => {
    const bodyweight = makeResult('cable-crunch', [{ reps: 10 }, { reps: 10 }, { reps: 10 }]);
    const verdict = evaluateDoubleProgression(presc(), bodyweight);
    expect(verdict.status).toBe('ready');
    expect(verdict.suggestedWeight).toBeNull();
  });

  it('counts a per-side set by its weaker side', () => {
    const p = presc({ perSide: true, repsHigh: 12, sets: 2, exerciseId: 'supported-split-squat' });
    const short = makeResult('supported-split-squat', [
      { repsLeft: 12, repsRight: 10, weight: 20 },
      { repsLeft: 12, repsRight: 12, weight: 20 },
    ]);
    expect(evaluateDoubleProgression(p, short).status).toBe('hold');
    const full = makeResult('supported-split-squat', [
      { repsLeft: 12, repsRight: 12, weight: 20 },
      { repsLeft: 13, repsRight: 12, weight: 20 },
    ]);
    expect(evaluateDoubleProgression(p, full).status).toBe('ready');
  });
});

describe('evaluateDoubleProgression — RIR never gates readiness', () => {
  // Hitting the top of the range at RIR 4 argues MORE strongly for more load,
  // not less. If this test starts failing, the gate was "fixed" backwards.
  it('is ready at a high RIR and says the load is light', () => {
    const easy = makeResult('incline-dumbbell-press', [
      { reps: 10, weight: 30, rir: 4 },
      { reps: 10, weight: 30, rir: 4 },
      { reps: 10, weight: 30, rir: 4 },
    ]);
    const verdict = evaluateDoubleProgression(presc(), easy);
    expect(verdict.status).toBe('ready');
    expect(verdict.message).toMatch(/above target/);
  });

  it('is ready at RIR 0 too, with a more cautious message', () => {
    const grind = makeResult('incline-dumbbell-press', [
      { reps: 10, weight: 30, rir: 0 },
      { reps: 10, weight: 30, rir: 0 },
      { reps: 10, weight: 30, rir: 0 },
    ]);
    const verdict = evaluateDoubleProgression(presc(), grind);
    expect(verdict.status).toBe('ready');
    expect(verdict.message).toMatch(/smallest step/);
  });

  it('says nothing extra when RIR sat inside the target band', () => {
    expect(evaluateDoubleProgression(presc(), topOfRange()).message).toBe(
      'Ready to increase load next session',
    );
  });
});

describe('evaluateDoubleProgression — band assistance', () => {
  const bandPresc = (overrides: Partial<ExercisePrescription> = {}) =>
    presc({
      exerciseId: 'band-assisted-pull-up',
      progressionType: 'bandAssist',
      sets: 3,
      repsLow: 6,
      repsHigh: 10,
      weightIncrement: null,
      recommendedBand: 'medium',
      ...overrides,
    });

  const bandResult = (band: 'heavy' | 'medium' | 'light' | 'none', reps = 10) =>
    makeResult('band-assisted-pull-up', [
      { reps, band, rir: 2 },
      { reps, band, rir: 1 },
      { reps, band, rir: 1 },
    ]);

  it('suggests the next lighter band', () => {
    const verdict = evaluateDoubleProgression(bandPresc(), bandResult('medium'));
    expect(verdict.status).toBe('ready');
    expect(verdict.kind).toBe('assistance');
    expect(verdict.message).toContain('Ready to reduce band assistance');
    expect(verdict.suggestedBand).toBe('light');
    expect(verdict.suggestedWeight).toBeNull();
  });

  it('falls back to the prescribed band when no set recorded one', () => {
    const noBand = makeResult('band-assisted-pull-up', [{ reps: 10 }, { reps: 10 }, { reps: 10 }]);
    expect(
      evaluateDoubleProgression(bandPresc({ recommendedBand: 'heavy' }), noBand).suggestedBand,
    ).toBe('medium');
  });

  it('switches to reps once unassisted', () => {
    const verdict = evaluateDoubleProgression(bandPresc(), bandResult('none'));
    expect(verdict.status).toBe('ready');
    expect(verdict.kind).toBe('reps');
    expect(verdict.suggestedBand).toBeNull();
  });

  it('holds below the top of the range', () => {
    const verdict = evaluateDoubleProgression(bandPresc(), bandResult('medium', 8));
    expect(verdict.status).toBe('hold');
    expect(verdict.suggestedBand).toBeNull();
  });
});

describe('set placeholders and recent history', () => {
  const lastWeek = makeSession({
    date: '2026-08-03',
    results: [
      {
        ...makeResult('incline-dumbbell-press', [
          { reps: 10, weight: 32, rir: 2 },
          { reps: 9, weight: 32, rir: 1 },
        ]),
      },
    ],
  });

  it('echoes the same set from last time', () => {
    const previous = previousResult([lastWeek], 'incline-dumbbell-press');
    expect(setHint(previous, 0)).toMatchObject({ weight: 32, reps: 10 });
    expect(setHint(previous, 1)).toMatchObject({ weight: 32, reps: 9 });
  });

  it('falls back to the last set logged when this session has more sets than that one did', () => {
    const previous = previousResult([lastWeek], 'incline-dumbbell-press');
    // Reload week 1 logged two sets; the third row of a full week still gets a hint.
    expect(setHint(previous, 2)).toMatchObject({ weight: 32, reps: 9 });
  });

  it('gives no hint for an exercise never logged', () => {
    expect(setHint(previousResult([lastWeek], 'cable-curl'), 0)).toBeNull();
  });

  it('lists recent performances newest first, capped', () => {
    const sessions = [1, 2, 3, 4].map((n) =>
      makeSession({
        id: `s${n}`,
        date: `2026-08-0${n}`,
        startedAt: `2026-08-0${n}T10:00:00.000Z`,
        results: [makeResult('cable-curl', [{ reps: 10 + n, weight: 20 }])],
      }),
    );
    expect(recentPerformances(sessions, 'cable-curl', 3).map((p) => p.date)).toEqual([
      '2026-08-04',
      '2026-08-03',
      '2026-08-02',
    ]);
  });
});
