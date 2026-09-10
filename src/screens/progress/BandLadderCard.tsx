import { Fragment } from 'react';
import { ChartCard } from '@/components/Charts';
import {
  BAND_LADDER,
  bandName,
  performanceHistory,
  type BandLabels,
} from '@/utils/doubleProgression';
import type { WorkoutSession } from '@/types';

const EXERCISE_ID = 'band-assisted-pull-up';

/**
 * The band-assistance ladder, `Heavy → Medium → Light → …`. Progress on the
 * assisted pull-up is a walk down this ladder, not a rep count — there is no
 * strict-pull-up test anywhere in this program, by design.
 */
export function BandLadderCard({
  sessions,
  bandLabels,
}: {
  sessions: WorkoutSession[];
  bandLabels: BandLabels;
}) {
  const history = performanceHistory(sessions, EXERCISE_ID).filter((h) => h.band != null);
  const current = history.at(-1)?.band ?? null;
  const currentIndex = current ? BAND_LADDER.indexOf(current) : -1;

  return (
    <ChartCard
      title="Pull-up assistance"
      subtitle="Less assistance is progress — each rung is one band lighter"
    >
      <div className="band-ladder">
        {BAND_LADDER.map((band, i) => (
          <Fragment key={band}>
            <span
              className={`rung ${
                i === currentIndex ? 'current' : i < currentIndex ? 'reached' : ''
              }`}
            >
              {bandName(band, bandLabels)}
            </span>
            {i < BAND_LADDER.length - 1 && (
              <span className="arrow" aria-hidden>
                →
              </span>
            )}
          </Fragment>
        ))}
      </div>

      <p className="muted tiny" style={{ margin: '10px 0 0' }}>
        {current
          ? `Currently on ${bandName(current, bandLabels)} across ${history.length} logged session${
              history.length === 1 ? '' : 's'
            }.`
          : 'Log an assisted pull-up set to place yourself on the ladder.'}
      </p>
    </ChartCard>
  );
}
