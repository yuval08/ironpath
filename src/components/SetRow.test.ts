import { describe, expect, it } from 'vitest';
import { makeSet } from '@/test/factories';
import { acceptSetHints, applyField, canBeLoaded, fieldsFor } from './SetRow';

describe('set fields by load type', () => {
  it('offers no weight box for a push-up', () => {
    const keys = fieldsFor('reps', 'kg', 'bodyweight').map((f) => f.key);
    expect(keys).not.toContain('weight');
    expect(keys).toEqual(['reps', 'rpe', 'rir']);
  });

  it('offers no weight box for a band drill', () => {
    expect(fieldsFor('reps', 'kg', 'band').map((f) => f.key)).not.toContain('weight');
    expect(fieldsFor('repsPerSide', 'kg', 'band').map((f) => f.key)).not.toContain('weight');
  });

  it('still offers weight for a goblet squat or hip thrust', () => {
    expect(fieldsFor('reps', 'kg', 'dumbbell').map((f) => f.key)).toContain('weight');
    expect(fieldsFor('time', 'kg', 'kettlebell').map((f) => f.key)).toContain('weight');
  });

  it('never offers weight for a dead hang or a pull-up', () => {
    expect(fieldsFor('time', 'kg', 'bodyweight').map((f) => f.key)).not.toContain('weight');
    expect(canBeLoaded('bodyweight')).toBe(false);
    expect(canBeLoaded('none')).toBe(false);
  });

  it('leaves treadmill entry untouched', () => {
    expect(fieldsFor('treadmill', 'kg', 'none').map((f) => f.key)).toEqual([
      'treadmillMinutes',
      'treadmillSpeed',
      'treadmillIncline',
    ]);
  });
});

describe('effort column', () => {
  it('records RIR alongside weight and reps for a loaded hypertrophy set', () => {
    expect(fieldsFor('reps', 'kg', 'dumbbell', 'rir').map((f) => f.key)).toEqual([
      'weight',
      'reps',
      'rir',
    ]);
  });

  it('keeps RPE for the resilience programs loaded exercises', () => {
    expect(fieldsFor('reps', 'kg', 'dumbbell').map((f) => f.key)).toEqual([
      'weight',
      'reps',
      'rpe',
    ]);
  });

  it('gives a loaded per-side exercise both sides, load and effort', () => {
    expect(fieldsFor('repsPerSide', 'kg', 'machine', 'rir').map((f) => f.key)).toEqual([
      'repsLeft',
      'repsRight',
      'weight',
      'rir',
    ]);
  });

  it('never shows more than four inputs, so a 360px row cannot overflow', () => {
    const styles = ['reps', 'repsPerSide', 'time', 'timePerSide', 'distance'] as const;
    for (const style of styles) {
      for (const load of ['dumbbell', 'bodyweight'] as const) {
        expect(fieldsFor(style, 'kg', load, 'rir').length).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('RIR-prescribed exercises without load', () => {
  it('drops the RPE column, leaving reps and RIR', () => {
    // The band-assisted pull-up: RIR is what the block prescribes, RPE was a dead box.
    expect(fieldsFor('reps', 'lb', 'band', 'rir').map((f) => f.key)).toEqual(['reps', 'rir']);
  });

  it('keeps both for the resilience block, which logs RPE', () => {
    expect(fieldsFor('reps', 'lb', 'bodyweight', 'rpe').map((f) => f.key)).toEqual([
      'reps',
      'rpe',
      'rir',
    ]);
  });
});

describe('applyField', () => {
  const blank = makeSet({ repsLeft: null, repsRight: null });

  it('fills the right side from the left when both sides are the same', () => {
    expect(applyField(blank, 'repsLeft', 10)).toMatchObject({ repsLeft: 10, repsRight: 10 });
  });

  it('keeps mirroring while the right still matches the left', () => {
    const both = applyField(blank, 'repsLeft', 10);
    expect(applyField(both, 'repsLeft', 11)).toMatchObject({ repsLeft: 11, repsRight: 11 });
  });

  it('never overwrites a right side the user set on its own', () => {
    const own = applyField(applyField(blank, 'repsLeft', 10), 'repsRight', 8);
    expect(applyField(own, 'repsLeft', 12)).toMatchObject({ repsLeft: 12, repsRight: 8 });
  });
});

describe('accepting visible hints', () => {
  const hint = makeSet({ weight: 40, reps: 10, repsLeft: 12, repsRight: 9, rir: 2, rpe: 8 });

  it('accepts blank weight and reps without copying effort or mutating either input', () => {
    const set = makeSet({ completed: false });
    expect(acceptSetHints(set, hint, 'reps', 'dumbbell', 'rir')).toMatchObject({
      weight: 40,
      reps: 10,
      rir: null,
      rpe: null,
      repsLeft: null,
      completed: false,
    });
    expect(set.weight).toBeNull();
    expect(hint.weight).toBe(40);
  });

  it('preserves explicit values including zero and asymmetric reps', () => {
    const set = makeSet({ weight: 0, repsLeft: 8, repsRight: null });
    expect(acceptSetHints(set, hint, 'repsPerSide', 'dumbbell')).toMatchObject({
      weight: 0,
      reps: null,
      repsLeft: 8,
      repsRight: 9,
    });
  });

  it('does not save hidden weights for bodyweight exercises', () => {
    expect(acceptSetHints(makeSet(), hint, 'reps', 'bodyweight')).toMatchObject({
      weight: null,
      reps: 10,
    });
  });

  it('does not invent missing hints or copy unhinted duration fields', () => {
    expect(acceptSetHints(makeSet(), null, 'reps', 'machine').weight).toBeNull();
    const timed = makeSet({ durationSeconds: 30, weight: 20 });
    expect(acceptSetHints(makeSet(), timed, 'time', 'kettlebell')).toMatchObject({
      weight: 20,
      durationSeconds: null,
    });
  });
});
