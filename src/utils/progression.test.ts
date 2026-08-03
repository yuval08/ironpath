import { describe, expect, it } from 'vitest';
import {
  detectProgressions,
  isSuccessfulResult,
  MIN_SUCCESSFUL_SESSIONS,
  recommendationFor,
  suggestStartWeight,
} from './progression';
import { makeResult, makeSession } from '@/test/factories';

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
