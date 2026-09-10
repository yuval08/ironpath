import { BAND_LADDER, bandName } from '@/utils/doubleProgression';
import type { BandLabels } from '@/utils/doubleProgression';
import type { BandResistance } from '@/types';

/**
 * Assistance ladder for band-assisted work. Every option carries a real value —
 * an empty option value silently writes `undefined` back into the set.
 *
 * Labels are partial by design: the user renames only the bands they actually
 * own, so each option resolves through `bandName`, which falls back to the
 * default name per band. An unlabelled band stays selectable.
 */
export function BandPicker({
  value,
  bandLabels,
  onChange,
}: {
  value: BandResistance | null;
  bandLabels?: BandLabels;
  onChange: (band: BandResistance) => void;
}) {
  return (
    <label className="field band-picker">
      Assistance band
      <select
        value={value ?? BAND_LADDER[0]}
        onChange={(e) => onChange(e.target.value as BandResistance)}
      >
        {BAND_LADDER.map((band) => (
          <option key={band} value={band}>
            {bandName(band, bandLabels)}
          </option>
        ))}
      </select>
    </label>
  );
}
