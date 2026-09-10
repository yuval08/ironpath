import { describe, expect, it } from 'vitest';
import { BAND_LADDER, bandName } from '/mnt/dev/tools/wopwa/src/utils/doubleProgression';

/**
 * The band select renders one <option> per ladder entry, valued by the band id
 * and labelled through `bandName`. Guards the invariant the markup depends on:
 * an option with an empty value writes `undefined` back into the set, and an
 * unlabelled band must still be pickable by its default name.
 */
describe('band picker options', () => {
  it('gives every band a non-empty option value', () => {
    expect(BAND_LADDER.length).toBeGreaterThan(0);
    for (const band of BAND_LADDER) {
      expect(band).toBeTruthy();
      expect(typeof band).toBe('string');
    }
    expect(new Set(BAND_LADDER).size).toBe(BAND_LADDER.length);
  });

  it('labels a band the user has not renamed', () => {
    for (const band of BAND_LADDER) {
      expect(bandName(band, {})).toBeTruthy();
      expect(bandName(band, { medium: 'Green 45mm' })).toBeTruthy();
    }
    expect(bandName('medium', { medium: 'Green 45mm' })).toBe('Green 45mm');
  });
});
