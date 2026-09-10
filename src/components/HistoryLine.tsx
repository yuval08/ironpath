import { formatPerformance } from '@/utils/doubleProgression';
import type { BandLabels, PerformanceSnapshot } from '@/utils/doubleProgression';
import type { ExercisePrescription } from '@/types';

/**
 * What the prescription asks for, in the same words the history line answers in.
 * Rendering the target next to the last result is what makes double progression
 * decidable at a glance — "did I own the top of this range last time?".
 */
export function targetLine(prescription: ExercisePrescription): string {
  const parts: string[] = [];
  const { repsLow, repsHigh, durationSecondsLow, durationSecondsHigh, perSide } = prescription;
  if (repsHigh != null) {
    const range =
      repsLow != null && repsLow !== repsHigh ? `${repsLow}–${repsHigh}` : `${repsHigh}`;
    parts.push(`${range}${perSide ? ' reps / side' : ' reps'}`);
  } else if (durationSecondsHigh != null) {
    parts.push(
      durationSecondsLow != null && durationSecondsLow !== durationSecondsHigh
        ? `${durationSecondsLow}–${durationSecondsHigh} s`
        : `${durationSecondsHigh} s`,
    );
  } else if (prescription.minutes != null) {
    parts.push(`${prescription.minutes} min`);
  }

  const { targetRirLow, targetRirHigh } = prescription;
  if (targetRirLow != null || targetRirHigh != null) {
    const low = targetRirLow ?? targetRirHigh;
    const high = targetRirHigh ?? targetRirLow;
    parts.push(`@ RIR ${low === high ? low : `${low}–${high}`}`);
  }
  return parts.join(' ');
}

export function HistoryLine({
  prescription,
  last,
  weightUnit,
  bandLabels,
}: {
  prescription: ExercisePrescription;
  last: PerformanceSnapshot | null;
  weightUnit: string;
  bandLabels?: BandLabels;
}) {
  const target = targetLine(prescription);
  return (
    <div className="history-line">
      <span className="muted tiny">
        <strong>Last session:</strong> {formatPerformance(last, weightUnit, bandLabels)}
      </span>
      {target && (
        <span className="muted tiny">
          <strong>Target:</strong> {target}
        </span>
      )}
    </div>
  );
}
