import { describe, expect, it } from 'vitest';
import {
  averageBackPain,
  averageKneePain,
  averageRpe,
  averageShoulderPain,
  completionPercent,
  convertWeight,
  exerciseReps,
  formatDuration,
  maxDurationForExercise,
  maxRepsForExercise,
  painLevel,
  pushUpBreakdown,
  pushUpTotal,
  pushUpTotalForWeek,
  sessionProgress,
  sessionVolume,
  setReps,
  totalRepsForExercise,
  weeklyVolume,
} from './stats';
import { makePain, makeResult, makeSession } from '@/test/factories';

describe('painLevel', () => {
  it('maps 0-2 to green, 3-4 to yellow, 5+ to red', () => {
    expect(painLevel(0)).toBe('green');
    expect(painLevel(2)).toBe('green');
    expect(painLevel(3)).toBe('yellow');
    expect(painLevel(4)).toBe('yellow');
    expect(painLevel(5)).toBe('red');
    expect(painLevel(10)).toBe('red');
  });

  it('treats a missing score as green rather than throwing', () => {
    expect(painLevel(null)).toBe('green');
    expect(painLevel(undefined)).toBe('green');
  });
});

describe('setReps', () => {
  it('uses the plain rep count when present', () => {
    expect(setReps({ ...emptySet, reps: 12 })).toBe(12);
  });

  it('sums both sides for per-side entries', () => {
    expect(setReps({ ...emptySet, repsLeft: 10, repsRight: 8 })).toBe(18);
  });

  it('counts a single logged side rather than discarding it', () => {
    expect(setReps({ ...emptySet, repsLeft: 10 })).toBe(10);
  });

  it('returns 0 when nothing was logged', () => {
    expect(setReps(emptySet)).toBe(0);
  });
});

const emptySet = {
  setNumber: 1,
  reps: null,
  repsLeft: null,
  repsRight: null,
  weight: null,
  durationSeconds: null,
  distanceMeters: null,
  treadmillMinutes: null,
  treadmillSpeed: null,
  treadmillIncline: null,
  rpe: null,
  rir: null,
  completed: true,
};

describe('exerciseReps', () => {
  it('only counts completed sets', () => {
    const result = makeResult('standard-push-up', [
      { reps: 15 },
      { reps: 12 },
      { reps: 10, completed: false },
    ]);
    expect(exerciseReps(result)).toBe(27);
  });
});

describe('push-up totals', () => {
  const session = makeSession({
    results: [
      makeResult('standard-push-up', [{ reps: 15 }, { reps: 14 }, { reps: 12 }]),
      makeResult('decline-push-up', [{ reps: 10 }, { reps: 9 }]),
      makeResult('pike-push-up', [{ reps: 8 }]),
      makeResult('inverted-row', [{ reps: 15 }]),
    ],
  });

  it('sums every push-up variation and ignores non-push-up work', () => {
    expect(pushUpTotal([session])).toBe(15 + 14 + 12 + 10 + 9 + 8);
  });

  it('reports each variation separately', () => {
    const breakdown = pushUpBreakdown([session]);
    expect(breakdown['standard-push-up']).toBe(41);
    expect(breakdown['decline-push-up']).toBe(19);
    expect(breakdown['pike-push-up']).toBe(8);
    expect(breakdown['pike-push-up-elevated']).toBe(0);
  });

  it('scopes totals to a week', () => {
    const week2 = makeSession({
      weekNumber: 2,
      results: [makeResult('standard-push-up', [{ reps: 20 }])],
    });
    expect(pushUpTotalForWeek([session, week2], 1)).toBe(68);
    expect(pushUpTotalForWeek([session, week2], 2)).toBe(20);
  });
});

describe('maxima', () => {
  const sessions = [
    makeSession({ results: [makeResult('strict-pull-up', [{ reps: 1 }, { reps: 2 }])] }),
    makeSession({ results: [makeResult('strict-pull-up', [{ reps: 3 }, { reps: 2 }])] }),
    makeSession({
      results: [makeResult('dead-hang', [{ durationSeconds: 30 }, { durationSeconds: 45 }])],
    }),
  ];

  it('finds the best single set across sessions', () => {
    expect(maxRepsForExercise(sessions, 'strict-pull-up')).toBe(3);
  });

  it('sums total reps across sessions', () => {
    expect(totalRepsForExercise(sessions, 'strict-pull-up')).toBe(8);
  });

  it('finds the longest hold', () => {
    expect(maxDurationForExercise(sessions, 'dead-hang')).toBe(45);
  });

  it('ignores incomplete sets when finding a max', () => {
    const withIncomplete = [
      makeSession({
        results: [makeResult('strict-pull-up', [{ reps: 2 }, { reps: 9, completed: false }])],
      }),
    ];
    expect(maxRepsForExercise(withIncomplete, 'strict-pull-up')).toBe(2);
  });
});

describe('completion', () => {
  it('is a percentage of the 20 planned sessions', () => {
    const sessions = Array.from({ length: 5 }, () => makeSession());
    expect(completionPercent(sessions)).toBe(25);
  });

  it('excludes in-progress and abandoned sessions', () => {
    const sessions = [
      makeSession(),
      makeSession({ status: 'inProgress' }),
      makeSession({ status: 'abandoned' }),
    ];
    expect(completionPercent(sessions)).toBe(5);
  });

  it('never exceeds 100 percent', () => {
    const sessions = Array.from({ length: 25 }, () => makeSession());
    expect(completionPercent(sessions)).toBe(100);
  });
});

describe('sessionProgress', () => {
  it('ignores skipped exercises in the denominator', () => {
    const session = makeSession({
      results: [
        makeResult('standard-push-up', [{ reps: 10 }]),
        makeResult('pike-push-up', [{ reps: 8 }], { completed: false }),
        makeResult('dead-hang', [{ durationSeconds: 20 }], {
          completed: false,
          skippedReason: 'Shoulder pain',
        }),
      ],
    });
    expect(sessionProgress(session)).toBe(50);
  });
});

describe('pain averages', () => {
  const sessions = [
    makeSession({
      painBefore: makePain({ leftKnee: 2, rightKnee: 4, lowerBack: 1 }),
      painAfter: makePain({ leftKnee: 0, rightKnee: 2, lowerBack: 3 }),
    }),
  ];

  it('averages both knees across before and after entries', () => {
    expect(averageKneePain(sessions)).toBe(2);
  });

  it('averages both shoulders', () => {
    expect(averageShoulderPain(sessions)).toBe(1);
  });

  it('averages lower back only', () => {
    expect(averageBackPain(sessions)).toBe(2);
  });

  it('returns null when nothing was recorded', () => {
    expect(averageKneePain([makeSession({ painBefore: null, painAfter: null })])).toBeNull();
  });
});

describe('volume', () => {
  it('multiplies weight by reps for completed sets only', () => {
    const session = makeSession({
      results: [
        makeResult('hip-thrust', [
          { reps: 12, weight: 40 },
          { reps: 12, weight: 40, completed: false },
        ]),
      ],
    });
    expect(sessionVolume(session)).toBe(480);
  });

  it('groups volume per week', () => {
    const week1 = makeSession({ results: [makeResult('hip-thrust', [{ reps: 10, weight: 30 }])] });
    const week2 = makeSession({
      weekNumber: 2,
      results: [makeResult('hip-thrust', [{ reps: 10, weight: 35 }])],
    });
    expect(weeklyVolume([week1, week2])).toEqual({ 1: 300, 2: 350 });
  });
});

describe('averageRpe', () => {
  it('averages every logged RPE in the session', () => {
    const session = makeSession({
      results: [
        makeResult('goblet-squat', [
          { reps: 12, rpe: 6 },
          { reps: 12, rpe: 7 },
        ]),
      ],
    });
    expect(averageRpe(session)).toBe(6.5);
  });

  it('is null when no RPE was recorded', () => {
    expect(
      averageRpe(makeSession({ results: [makeResult('goblet-squat', [{ reps: 12 }])] })),
    ).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('formats hours once past 60 minutes', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});

describe('convertWeight', () => {
  it('round-trips kg and lb', () => {
    expect(convertWeight(100, 'kg', 'lb')).toBeCloseTo(220.5, 1);
    expect(convertWeight(220.5, 'lb', 'kg')).toBeCloseTo(100, 1);
  });

  it('is a no-op for the same unit', () => {
    expect(convertWeight(42.55, 'kg', 'kg')).toBe(42.6);
  });
});

/**
 * Regression: `exerciseId` is the planned slot and `substitutionExerciseId` is what
 * was actually done. Matching on the slot credited band-assisted reps to strict
 * pull-ups on the Dashboard while the Progress chart showed zero for the same data.
 */
describe('substitution attribution', () => {
  const substituted = [
    makeSession({
      results: [
        makeResult('strict-pull-up', [{ reps: 8 }], {
          substitutionExerciseId: 'band-assisted-pull-up',
        }),
      ],
    }),
  ];

  it('credits reps to the exercise performed, not the one it replaced', () => {
    expect(maxRepsForExercise(substituted, 'strict-pull-up')).toBe(0);
    expect(maxRepsForExercise(substituted, 'band-assisted-pull-up')).toBe(8);
    expect(totalRepsForExercise(substituted, 'strict-pull-up')).toBe(0);
    expect(totalRepsForExercise(substituted, 'band-assisted-pull-up')).toBe(8);
  });

  it('does not count a substituted movement toward the push-up total', () => {
    const sessions = [
      makeSession({
        results: [
          makeResult('standard-push-up', [{ reps: 20 }], {
            substitutionExerciseId: 'dead-hang',
          }),
        ],
      }),
    ];
    expect(pushUpTotal(sessions)).toBe(0);
  });

  it('counts a substitution that is itself a push-up variation', () => {
    const sessions = [
      makeSession({
        results: [
          makeResult('decline-push-up', [{ reps: 12 }], {
            substitutionExerciseId: 'standard-push-up',
          }),
        ],
      }),
    ];
    expect(pushUpTotal(sessions)).toBe(12);
    expect(pushUpBreakdown(sessions)['standard-push-up']).toBe(12);
    expect(pushUpBreakdown(sessions)['decline-push-up']).toBe(0);
  });

  it('excludes skipped exercises from records and totals', () => {
    const sessions = [
      makeSession({
        results: [makeResult('strict-pull-up', [{ reps: 5 }], { skippedReason: 'Shoulder pain' })],
      }),
    ];
    expect(maxRepsForExercise(sessions, 'strict-pull-up')).toBe(0);
    expect(totalRepsForExercise(sessions, 'strict-pull-up')).toBe(0);
  });

  it('still reports duration records for a substituted hold', () => {
    const sessions = [
      makeSession({
        results: [
          makeResult('dead-hang', [{ durationSeconds: 40 }], {
            substitutionExerciseId: 'bear-crawl',
          }),
        ],
      }),
    ];
    expect(maxDurationForExercise(sessions, 'dead-hang')).toBe(0);
    expect(maxDurationForExercise(sessions, 'bear-crawl')).toBe(40);
  });
});
