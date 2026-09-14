import { ChevronRight } from 'lucide-react';
import { ChartCard } from '@/components/Charts';
import { exerciseName } from '@/data/exercises';
import {
  bandName,
  formatPerformance,
  performanceHistory,
  type BandLabels,
  type PerformanceSnapshot,
} from '@/utils/doubleProgression';
import type { WorkoutSession } from '@/types';

/**
 * How far a lift has moved since it was first logged. Load for weighted work;
 * for the assisted pull-up the band IS the progress, so it reads as the ladder.
 */
export function liftChange(
  history: PerformanceSnapshot[],
  unit: string,
  bandLabels?: BandLabels,
): string | null {
  const first = history[0];
  const last = history.at(-1);
  if (!first || !last || history.length < 2) return null;
  if (first.weight != null && last.weight != null) {
    const delta = Math.round((last.weight - first.weight) * 10) / 10;
    if (delta === 0) return 'Same load as the first session';
    return `${delta > 0 ? '+' : ''}${delta} ${unit} since the first session`;
  }
  if (first.band != null && last.band != null && first.band !== last.band) {
    return `${bandName(first.band, bandLabels)} → ${bandName(last.band, bandLabels)}`;
  }
  return null;
}

/**
 * The lifts the program names as its measures of progress, one row each, in the
 * program's own order. Tapping a row charts it below — the summary answers "am I
 * moving?", the chart answers "how?".
 */
export function KeyLiftsCard({
  lifts,
  sessions,
  unit,
  bandLabels,
  onSelect,
}: {
  lifts: string[];
  sessions: WorkoutSession[];
  unit: string;
  bandLabels?: BandLabels;
  onSelect: (exerciseId: string) => void;
}) {
  if (lifts.length === 0) return null;
  return (
    <ChartCard title="Key lifts" subtitle="Last session and change since you started">
      <div className="key-lifts">
        {lifts.map((id) => {
          const history = performanceHistory(sessions, id);
          const change = liftChange(history, unit, bandLabels);
          return (
            <button key={id} className="key-lift" onClick={() => onSelect(id)}>
              <span className="key-lift-text">
                <span className="key-lift-name">{exerciseName(id)}</span>
                <span className="muted tiny">
                  {formatPerformance(history.at(-1) ?? null, unit, bandLabels)}
                </span>
                {change && <span className="key-lift-change tiny">{change}</span>}
              </span>
              <ChevronRight size={16} aria-hidden />
            </button>
          );
        })}
      </div>
    </ChartCard>
  );
}
