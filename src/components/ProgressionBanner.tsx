import { TrendingUp } from 'lucide-react';
import { bandName } from '@/utils/doubleProgression';
import type { BandLabels, ProgressionVerdict } from '@/utils/doubleProgression';

/**
 * Progression is never applied for the user. This banner only reports what the
 * previous session earned and offers to prefill THIS session's sets — the stored
 * history it was derived from is never touched.
 */
export function ProgressionBanner({
  verdict,
  weightUnit,
  bandLabels,
  onApply,
}: {
  verdict: ProgressionVerdict;
  weightUnit: string;
  bandLabels?: BandLabels;
  onApply: () => void;
}) {
  if (verdict.status !== 'ready') return null;

  const applyLabel =
    verdict.suggestedWeight != null
      ? `Use ${verdict.suggestedWeight} ${weightUnit} this session`
      : verdict.suggestedBand != null
        ? `Use ${bandName(verdict.suggestedBand, bandLabels)} this session`
        : null;

  return (
    <div className="banner info progression-banner">
      <div className="row tight">
        <TrendingUp size={15} />
        {/* The engine may append an RIR-coloured suffix — render its message verbatim. */}
        <strong>{verdict.message}</strong>
      </div>
      {applyLabel && (
        <button className="btn small primary" style={{ marginTop: 8 }} onClick={onApply}>
          {applyLabel}
        </button>
      )}
    </div>
  );
}
