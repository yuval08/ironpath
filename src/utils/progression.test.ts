import { describe, expect, it } from 'vitest';
import {
  detectProgressions,
  isSuccessfulResult,
  MIN_SUCCESSFUL_SESSIONS,
  recommendationFor,
  suggestStartWeight,
} from './progression';
import { makePlan, makeResult, makeSession } from '@/test/factories';
import { SCHEMA_VERSION } from '@/types';
import type { ExercisePrescription, ProgressionSuggestion, SetResult, WorkoutPlan } from '@/types';

describe('isSuccessfulResult', () => {
  it('accepts a clean, complete, low-pain, low-RPE result', () => {
    const result = makeResult('goblet-squat', [
      { reps: 12, rpe: 6 },
      { reps: 12, rpe: 7 },
      { reps: 12, rpe: 7 },
    ]);
    expect(isSuccessfulResult(result)).toBe(true);
  });

  it('rejects a result with an unfinished set', () => {
    const result = makeResult('goblet-squat', [{ reps: 12 }, { reps: 12, completed: false }]);
    expect(isSuccessfulResult(result)).toBe(false);
  });

  it('rejects when form broke down', () => {
    const result = makeResult('goblet-squat', [{ reps: 12 }], { formGood: false });
    expect(isSuccessfulResult(result)).toBe(false);
  });

  it('rejects when form was never rated', () => {
    const result = makeResult('goblet-squat', [{ reps: 12 }], { formGood: null });
    expect(isSuccessfulResult(result)).toBe(false);
  });

  it('rejects pain above 2', () => {
    const result = makeResult('goblet-squat', [{ reps: 12 }], { painDuring: 3 });
    expect(isSuccessfulResult(result)).toBe(false);
  });

  it('allows pain of exactly 2', () => {
    const result = makeResult('goblet-squat', [{ reps: 12 }], { painDuring: 2 });
    expect(isSuccessfulResult(result)).toBe(true);
  });

  it('rejects an RPE above 7 on any set', () => {
    const result = makeResult('goblet-squat', [
      { reps: 12, rpe: 6 },
      { reps: 12, rpe: 8 },
    ]);
    expect(isSuccessfulResult(result)).toBe(false);
  });

  it('rejects a skipped exercise', () => {
    const result = makeResult('goblet-squat', [{ reps: 12 }], { skippedReason: 'Knee' });
    expect(isSuccessfulResult(result)).toBe(false);
  });

  it('rejects when fewer sets were logged than planned', () => {
    const result = makeResult('goblet-squat', [{ reps: 12 }], { plannedSets: 3 });
    expect(isSuccessfulResult(result)).toBe(false);
  });
});

describe('detectProgressions', () => {
  const cleanSession = () =>
    makeSession({
      results: [
        makeResult('goblet-squat', [
          { reps: 15, rpe: 6 },
          { reps: 15, rpe: 6 },
        ]),
      ],
    });

  it('needs at least two successful sessions', () => {
    expect(detectProgressions([cleanSession()])).toHaveLength(0);
    expect(detectProgressions([cleanSession(), cleanSession()])).toHaveLength(1);
    expect(MIN_SUCCESSFUL_SESSIONS).toBe(2);
  });

  it('ignores sessions that are not completed', () => {
    const inProgress = makeSession({
      status: 'inProgress',
      results: [makeResult('goblet-squat', [{ reps: 15, rpe: 6 }])],
    });
    expect(detectProgressions([cleanSession(), inProgress])).toHaveLength(0);
  });

  it('does not re-raise a suggestion that is already pending or accepted', () => {
    const sessions = [cleanSession(), cleanSession()];
    const first = detectProgressions(sessions);
    expect(detectProgressions(sessions, first)).toHaveLength(0);
    const accepted = first.map((s) => ({ ...s, status: 'accepted' as const }));
    expect(detectProgressions(sessions, accepted)).toHaveLength(0);
  });

  it('does not re-raise a dismissed suggestion', () => {
    // Re-raising would mint a new row after every completed session, so the user
    // would accumulate duplicates of advice they already declined.
    const sessions = [cleanSession(), cleanSession()];
    const dismissed = detectProgressions(sessions).map((s) => ({
      ...s,
      status: 'dismissed' as const,
    }));
    expect(detectProgressions(sessions, dismissed)).toHaveLength(0);
  });

  it('produces a pending suggestion with a human-readable reason', () => {
    const [suggestion] = detectProgressions([cleanSession(), cleanSession()]);
    expect(suggestion?.status).toBe('pending');
    expect(suggestion?.exerciseName).toBe('Goblet Squat');
    expect(suggestion?.reason).toContain('2 clean sessions');
    expect(suggestion?.recommendation.length).toBeGreaterThan(10);
  });
});

describe('recommendationFor', () => {
  it('suggests less assistance for band-assisted pull-ups', () => {
    expect(recommendationFor('band-assisted-pull-up').kind).toBe('assistance');
  });

  it('suggests treadmill progression by time then speed', () => {
    const rec = recommendationFor('backward-treadmill-walk');
    expect(rec.kind).toBe('treadmill');
    expect(rec.text).toMatch(/0\.1-0\.2 mph/);
  });

  it('suggests a stronger band for band exercises without a bespoke rule', () => {
    expect(recommendationFor('band-face-pull').kind).toBe('band');
  });

  it('falls back to adding reps', () => {
    expect(recommendationFor('inverted-row').kind).toBe('reps');
  });
});

describe('suggestStartWeight', () => {
  it('halves the previous working weight', () => {
    expect(suggestStartWeight(100)).toBe(50);
    expect(suggestStartWeight(60)).toBe(30);
  });

  it('rounds to the nearest 2.5 increment', () => {
    expect(suggestStartWeight(47)).toBe(22.5);
    expect(suggestStartWeight(135)).toBe(67.5);
  });

  it('never returns less than the lightest usable load', () => {
    expect(suggestStartWeight(1)).toBe(2.5);
  });
});

describe('substitution and dismissal handling (regression)', () => {
  const substitutedSession = () =>
    makeSession({
      results: [
        makeResult(
          'strict-pull-up',
          [
            { reps: 6, rpe: 6 },
            { reps: 6, rpe: 6 },
          ],
          { substitutionExerciseId: 'band-assisted-pull-up' },
        ),
      ],
    });

  it('suggests progressing the exercise actually performed', () => {
    const [suggestion] = detectProgressions([substitutedSession(), substitutedSession()]);
    expect(suggestion?.exerciseId).toBe('band-assisted-pull-up');
    expect(suggestion?.exerciseName).toBe('Band-Assisted Pull-Up');
    // Band-assisted gets the assistance-reduction advice, not "add a clean rep".
    expect(suggestion?.kind).toBe('assistance');
  });

  it('never re-raises a dismissed suggestion', () => {
    const sessions = [substitutedSession(), substitutedSession()];
    const dismissed = detectProgressions(sessions).map((s) => ({
      ...s,
      status: 'dismissed' as const,
    }));
    expect(detectProgressions(sessions, dismissed)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Double progression (plan-aware)                                     */
/* ------------------------------------------------------------------ */

const DOUBLE_PRESC: ExercisePrescription = {
  id: 'presc-incline',
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
  rampSets: 2,
};

function doublePlan(prescriptions = [DOUBLE_PRESC]): WorkoutPlan {
  return makePlan({
    weeks: [
      {
        weekNumber: 1,
        title: 'Hypertrophy Week 1',
        focus: 'Upper',
        guidance: [],
        phase: 'hypertrophy',
        blockWeek: 1,
        days: [
          {
            id: 'w1-upperA',
            weekNumber: 1,
            weekday: 'monday',
            dayType: 'upperA',
            title: 'Upper A',
            focus: 'Chest',
            estimatedMinutes: 50,
            prescriptions,
          },
        ],
      },
    ],
  });
}

const doubleSession = (sets: Partial<SetResult>[], date = '2026-08-03') =>
  makeSession({
    date,
    dayId: 'w1-upperA',
    completedAt: `${date}T09:00:00.000Z`,
    startedAt: `${date}T08:00:00.000Z`,
    results: [
      makeResult('incline-dumbbell-press', sets, {
        prescriptionId: 'presc-incline',
        plannedSets: 3,
      }),
    ],
  });

const topOfRange: Partial<SetResult>[] = [
  { reps: 10, weight: 30, rir: 2 },
  { reps: 10, weight: 30, rir: 1 },
  { reps: 10, weight: 30, rir: 1 },
];

describe('detectProgressions with a double-progression plan', () => {
  it('fires after a single qualifying session', () => {
    const suggestions = detectProgressions([doubleSession(topOfRange)], [], doublePlan());
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.exerciseId).toBe('incline-dumbbell-press');
    expect(suggestions[0]?.kind).toBe('weight');
    expect(suggestions[0]?.recommendation).toContain('32');
    expect(suggestions[0]?.reason).toContain('top of the rep range');
  });

  it('stays silent when the top of the range was missed', () => {
    const short = [
      { reps: 10, weight: 30 },
      { reps: 9, weight: 30 },
      { reps: 8, weight: 30 },
    ];
    expect(detectProgressions([doubleSession(short)], [], doublePlan())).toHaveLength(0);
  });

  it('ignores ramp sets when checking the working sets', () => {
    const withRamp = [
      { reps: 5, weight: 15, isWarmUp: true },
      { reps: 3, weight: 22, isWarmUp: true },
      ...topOfRange,
    ];
    expect(detectProgressions([doubleSession(withRamp)], [], doublePlan())).toHaveLength(1);
  });

  it('does not let ramp sets stand in for missing working sets', () => {
    const rampPadded = [
      { reps: 10, weight: 30, isWarmUp: true },
      { reps: 10, weight: 30 },
      { reps: 10, weight: 30 },
    ];
    expect(detectProgressions([doubleSession(rampPadded)], [], doublePlan())).toHaveLength(0);
  });

  it('falls back to the old two-session heuristic without a plan', () => {
    expect(detectProgressions([doubleSession(topOfRange)])).toHaveLength(0);
    expect(
      detectProgressions([doubleSession(topOfRange), doubleSession(topOfRange, '2026-08-10')]),
    ).toHaveLength(1);
  });

  it('recommends a lighter band for a bandAssist prescription', () => {
    const bandPresc: ExercisePrescription = {
      ...DOUBLE_PRESC,
      id: 'presc-pullup',
      exerciseId: 'band-assisted-pull-up',
      progressionType: 'bandAssist',
      weightIncrement: null,
      recommendedBand: 'medium',
    };
    const session = makeSession({
      dayId: 'w1-upperA',
      results: [
        makeResult(
          'band-assisted-pull-up',
          [
            { reps: 10, band: 'medium' },
            { reps: 10, band: 'medium' },
            { reps: 10, band: 'medium' },
          ],
          { prescriptionId: 'presc-pullup', plannedSets: 3 },
        ),
      ],
    });
    const [suggestion] = detectProgressions([session], [], doublePlan([bandPresc]));
    expect(suggestion?.kind).toBe('assistance');
    expect(suggestion?.recommendation).toMatch(/Light/i);
  });
});

describe('re-raising a settled suggestion', () => {
  const settled = (
    status: 'accepted' | 'dismissed',
    detectedAt: string,
  ): ProgressionSuggestion => ({
    id: 'sug_old',
    createdAt: detectedAt,
    updatedAt: detectedAt,
    schemaVersion: SCHEMA_VERSION,
    exerciseId: 'incline-dumbbell-press',
    exerciseName: 'Incline Dumbbell Press',
    reason: 'earlier',
    recommendation: 'earlier',
    kind: 'weight',
    status,
    detectedAt,
  });

  const plan = doublePlan();
  const sessions = [doubleSession(topOfRange, '2026-08-10')];

  it('re-raises after an accepted suggestion once a newer session qualifies', () => {
    expect(
      detectProgressions(sessions, [settled('accepted', '2026-08-01T00:00:00.000Z')], plan),
    ).toHaveLength(1);
  });

  it('re-raises after a dismissed suggestion once a newer session qualifies', () => {
    expect(
      detectProgressions(sessions, [settled('dismissed', '2026-08-01T00:00:00.000Z')], plan),
    ).toHaveLength(1);
  });

  it('stays silent when the qualifying session predates the settled suggestion', () => {
    expect(
      detectProgressions(sessions, [settled('accepted', '2026-09-01T00:00:00.000Z')], plan),
    ).toHaveLength(0);
    expect(
      detectProgressions(sessions, [settled('dismissed', '2026-09-01T00:00:00.000Z')], plan),
    ).toHaveLength(0);
  });

  it('never duplicates a suggestion that is still pending', () => {
    const pending = {
      ...settled('accepted', '2026-08-01T00:00:00.000Z'),
      status: 'pending' as const,
    };
    expect(detectProgressions(sessions, [pending], plan)).toHaveLength(0);
  });
});

describe('warm-up sets are invisible to the old heuristic too', () => {
  it('counts only the working sets against plannedSets', () => {
    const result = makeResult(
      'goblet-squat',
      [
        { reps: 5, isWarmUp: true },
        { reps: 15, rpe: 6 },
        { reps: 15, rpe: 6 },
      ],
      { plannedSets: 2 },
    );
    expect(isSuccessfulResult(result)).toBe(true);
  });

  it('ignores the RPE of a hard ramp set', () => {
    const result = makeResult(
      'goblet-squat',
      [
        { reps: 3, rpe: 9, isWarmUp: true },
        { reps: 15, rpe: 6 },
      ],
      { plannedSets: 1 },
    );
    expect(isSuccessfulResult(result)).toBe(true);
  });
});
