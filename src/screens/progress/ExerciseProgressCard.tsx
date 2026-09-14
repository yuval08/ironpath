import { useMemo, useState } from 'react';
import { ChartCard, LineChart, type Point } from '@/components/Charts';
import { exerciseName } from '@/data/exercises';
import { formatPerformance, performanceHistory, type BandLabels } from '@/utils/doubleProgression';
import type { WorkoutPlan, WorkoutSession } from '@/types';

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/**
 * Weight and rep progression for one exercise at a time. A chart per exercise
 * would be twenty charts on a phone; a picker keeps the screen readable and
 * makes every exercise in the plan reachable rather than a hand-picked few.
 */
export function ExerciseProgressCard({
  plan,
  sessions,
  unit,
  bandLabels,
  selected: controlled,
  onSelect,
}: {
  plan: WorkoutPlan;
  sessions: WorkoutSession[];
  unit: string;
  bandLabels: BandLabels;
  /** When given, the parent owns the choice — so a key-lift row can chart itself here. */
  selected?: string | null;
  onSelect?: (exerciseId: string) => void;
}) {
  // Every exercise the plan prescribes, in the order the plan runs them, so the
  // picker reads like the programme rather than like the exercise library.
  const exerciseIds = useMemo(() => {
    const seen = new Set<string>();
    for (const week of plan.weeks) {
      for (const day of week.days) {
        for (const p of day.prescriptions) seen.add(p.exerciseId);
      }
    }
    return [...seen];
  }, [plan]);

  const [own, setOwn] = useState<string>(exerciseIds[0] ?? '');
  const selected = controlled ?? own;
  const setSelected = (id: string) => (onSelect ? onSelect(id) : setOwn(id));
  const history = useMemo(() => performanceHistory(sessions, selected), [sessions, selected]);

  const weightPoints: Point[] = history
    .filter((h) => h.weight != null)
    .map((h) => ({ label: shortDate(h.date), value: h.weight as number }));

  const repPoints: Point[] = history
    .filter((h) => h.reps.length > 0)
    .map((h) => ({ label: shortDate(h.date), value: Math.max(...h.reps) }));

  if (exerciseIds.length === 0) return null;

  return (
    <ChartCard
      title="Exercise progression"
      subtitle="Top set per session"
      id="exercise-progression"
    >
      <label className="field">
        Exercise
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {exerciseIds.map((id) => (
            <option key={id} value={id}>
              {exerciseName(id)}
            </option>
          ))}
        </select>
      </label>

      <p className="muted tiny" style={{ margin: '10px 0 4px' }}>
        Last session: {formatPerformance(history.at(-1) ?? null, unit, bandLabels)}
      </p>

      <div className="muted tiny" style={{ marginTop: 10 }}>
        Working weight ({unit})
      </div>
      <LineChart
        points={weightPoints}
        suffix={` ${unit}`}
        emptyMessage="No weights logged for this exercise yet."
      />

      <div className="muted tiny" style={{ marginTop: 10 }}>
        Best set reps
      </div>
      <LineChart
        points={repPoints}
        suffix=" reps"
        emptyMessage="No reps logged for this exercise yet."
      />
    </ChartCard>
  );
}
