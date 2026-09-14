import { format, parse } from 'date-fns';
import { bandName } from '@/utils/doubleProgression';
import type { BandLabels, PerformanceSnapshot } from '@/utils/doubleProgression';
import type { SetResult } from '@/types';

function setLine(set: SetResult, weightUnit: string, bandLabels?: BandLabels): string {
  const parts: string[] = [];
  if (set.weight != null) parts.push(`${set.weight} ${weightUnit}`);
  else if (set.band != null)
    parts.push(set.band === 'none' ? 'Bodyweight' : bandName(set.band, bandLabels));

  const reps =
    set.repsLeft != null || set.repsRight != null
      ? set.repsLeft === set.repsRight
        ? `${set.repsLeft ?? '–'} / side`
        : `${set.repsLeft ?? '–'} L · ${set.repsRight ?? '–'} R`
      : set.reps != null
        ? `${set.reps}`
        : null;
  if (reps != null) parts.push(parts.length ? `× ${reps}` : `${reps} reps`);
  if (set.rir != null) parts.push(`RIR ${set.rir}`);
  return parts.join(' ') || '—';
}

function dateLabel(iso: string): string {
  // yyyy-MM-dd is a LOCAL calendar date; `new Date(iso)` would read it as UTC.
  const date = parse(iso, 'yyyy-MM-dd', new Date());
  return Number.isNaN(date.getTime()) ? iso : format(date, 'EEE d MMM');
}

/**
 * Set-by-set record of the last few times an exercise was done — the detail
 * behind the one-line summary on the card, for deciding today's load.
 */
export function ExerciseHistory({
  history,
  weightUnit,
  bandLabels,
}: {
  history: PerformanceSnapshot[];
  weightUnit: string;
  bandLabels?: BandLabels;
}) {
  return (
    <section className="exercise-history" aria-label="History">
      <h3>History</h3>
      {history.length === 0 ? (
        <p className="muted tiny" style={{ margin: 0 }}>
          Nothing logged yet — this will fill in after your first session.
        </p>
      ) : (
        history.map((snap, i) => (
          <div className="history-session" key={`${snap.date}-${i}`}>
            <div className="history-date">
              {i === 0 ? 'Last time' : dateLabel(snap.date)}
              {i === 0 && <span className="muted"> · {dateLabel(snap.date)}</span>}
            </div>
            <ol className="history-sets">
              {snap.sets.map((set, n) => (
                <li key={set.setNumber} className={set.completed ? undefined : 'muted'}>
                  <span className="history-set-no">{n + 1}</span>
                  {setLine(set, weightUnit, bandLabels)}
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}
