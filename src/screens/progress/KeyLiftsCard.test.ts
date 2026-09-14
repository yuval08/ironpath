import { describe, expect, it } from 'vitest';
import type { PerformanceSnapshot } from '@/utils/doubleProgression';
import { liftChange } from './KeyLiftsCard';

const snap = (overrides: Partial<PerformanceSnapshot>): PerformanceSnapshot => ({
  date: '2026-09-14',
  weight: null,
  band: null,
  reps: [10],
  rir: [],
  sets: [],
  ...overrides,
});

describe('liftChange', () => {
  it('reports load gained since the first session', () => {
    expect(liftChange([snap({ weight: 30 }), snap({ weight: 40 })], 'lb')).toBe(
      '+10 lb since the first session',
    );
  });

  it('reports band progress as a move down the ladder', () => {
    expect(liftChange([snap({ band: 'heavy' }), snap({ band: 'medium' })], 'lb')).toBe(
      'Heavy → Medium',
    );
  });

  it('says nothing until there are two sessions to compare', () => {
    expect(liftChange([snap({ weight: 30 })], 'lb')).toBeNull();
  });
});
