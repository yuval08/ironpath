import { describe, expect, it } from 'vitest';
import { exercisePrescriptionSchema } from '@/types';
import type { ExercisePrescription, WorkoutDay } from '@/types';
import { makeResult, makeSession } from '@/test/factories';
import { nextUp, nextUpLine } from './nextUp';

function prescription(id: string, order: number, extra: Partial<ExercisePrescription> = {}) {
  return exercisePrescriptionSchema.parse({
    id,
    exerciseId: id,
    block: 'A',
    blockLabel: 'Block A',
    order,
    sets: 3,
    repsLow: 8,
    repsHigh: 12,
    restSeconds: 90,
    entryStyle: 'reps',
    ...extra,
  });
}

function day(prescriptions: ExercisePrescription[]): WorkoutDay {
  return {
    id: 'd1',
    weekNumber: 1,
    weekday: 'monday',
    dayType: 'upperA',
    title: 'Day',
    focus: '',
    estimatedMinutes: 60,
    prescriptions,
  };
}

const result = (id: string, done: number, total = 3, overrides = {}) =>
  makeResult(
    id,
    Array.from({ length: total }, (_, i) => ({ completed: i < done, weight: null })),
    { prescriptionId: id, completed: done === total, ...overrides },
  );

const none = () => null;

describe('nextUp', () => {
  it('continues the current exercise with its next set and load', () => {
    const session = makeSession({
      results: [result('bench', 1, 3, { recommendedWeight: 60 }), result('row', 0)],
    });
    const next = nextUp(
      day([prescription('bench', 1), prescription('row', 2)]),
      session,
      none,
      'kg',
    );
    expect(next).toMatchObject({ kind: 'set', detail: 'Set 2 of 3 · 8-12 reps · 60 kg' });
    expect(nextUpLine(next)).toMatch(/^Next set: /);
  });

  it('moves to the next exercise once every set is done, ignoring skipped ones', () => {
    const session = makeSession({
      results: [
        result('bench', 3),
        result('row', 0, 3, { skippedReason: 'pain' }),
        result('curl', 0, 2),
      ],
    });
    const next = nextUp(
      day([prescription('bench', 1), prescription('row', 2), prescription('curl', 3)]),
      session,
      none,
      'kg',
    );
    expect(next).toMatchObject({ kind: 'exercise', detail: 'Set 1 of 2 · 8-12 reps' });
    expect(nextUpLine(next)).toMatch(/^Next exercise: /);
  });

  it('walks a superset back to the first slot and uses the previous session load', () => {
    const a1 = prescription('pull', 1, { supersetKey: 'A', slot: 'A1' });
    const a2 = prescription('press', 2, { supersetKey: 'A', slot: 'A2' });
    const session = makeSession({ results: [result('pull', 1), result('press', 1)] });
    const previous = makeResult('pull', [{ weight: 20 }, { weight: 22.5 }]);
    const next = nextUp(day([a1, a2]), session, () => previous, 'kg');
    expect(next?.title).toMatch(/^A1 · /);
    expect(next?.detail).toBe('Set 2 of 3 · 8-12 reps · 22.5 kg');
  });

  it('returns null when the workout is done', () => {
    const session = makeSession({ results: [result('bench', 3)] });
    expect(nextUp(day([prescription('bench', 1)]), session, none, 'kg')).toBeNull();
  });
});
