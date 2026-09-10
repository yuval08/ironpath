import { describe, expect, it } from 'vitest';
import { canBeLoaded, fieldsFor } from '/mnt/dev/tools/wopwa/src/components/SetRow';

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
