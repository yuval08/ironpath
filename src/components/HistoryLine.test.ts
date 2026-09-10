import { describe, expect, it } from 'vitest';
import { targetLine } from '/mnt/dev/tools/wopwa/src/components/HistoryLine';
import { exercisePrescriptionSchema } from '/mnt/dev/tools/wopwa/src/types';
import type { ExercisePrescription } from '/mnt/dev/tools/wopwa/src/types';

function prescription(patch: Partial<ExercisePrescription>): ExercisePrescription {
  return exercisePrescriptionSchema.parse({
    id: 'p1',
    exerciseId: 'incline-dumbbell-press',
    block: 'A',
    blockLabel: 'Superset A',
    order: 1,
    sets: 3,
    restSeconds: 90,
    entryStyle: 'reps',
    ...patch,
  });
}

describe('target line', () => {
  it('reads the rep range with the RIR target', () => {
    expect(
      targetLine(prescription({ repsLow: 6, repsHigh: 10, targetRirLow: 1, targetRirHigh: 2 })),
    ).toBe('6–10 reps @ RIR 1–2');
  });

  it('collapses a single-value range', () => {
    expect(
      targetLine(prescription({ repsLow: 8, repsHigh: 8, targetRirLow: 3, targetRirHigh: 3 })),
    ).toBe('8 reps @ RIR 3');
  });

  it('marks per-side work', () => {
    expect(targetLine(prescription({ repsLow: 8, repsHigh: 12, perSide: true }))).toBe(
      '8–12 reps / side',
    );
  });

  it('falls back to a duration when there are no reps', () => {
    expect(
      targetLine(
        prescription({ durationSecondsLow: 20, durationSecondsHigh: 40, entryStyle: 'time' }),
      ),
    ).toBe('20–40 s');
  });
});
