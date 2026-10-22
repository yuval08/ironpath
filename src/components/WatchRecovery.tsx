import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { exerciseName } from '@/data/exercises';
import { db } from '@/db/db';
import { resolveReview, reviewWatchAction, watchRecoveryActions } from '@/watch/recovery';
import type { ReviewItem, WatchReviewItem } from '@/watch/recovery';
import type { WorkoutSession } from '@/types';
import { allReviewFields } from '@/watch/reviews';
import { same } from '@/watch/mutations';

const FIELD_LABELS: Record<string, string> = {
  completed: 'Completed',
  reps: 'Reps',
  repsLeft: 'Left reps',
  repsRight: 'Right reps',
  weight: 'Weight (workout unit)',
  rpe: 'Effort (RPE)',
  rir: 'Reps in reserve',
};

function display(value: unknown): string {
  if (value == null) return 'Not logged';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  return String(value);
}

function liveSet(sessions: WorkoutSession[], review: WatchReviewItem['review']) {
  const session = sessions.find((row) => row.id === review.sessionId);
  const set = session?.results
    .find((row) => row.prescriptionId === review.prescriptionId)
    ?.sets.find((row) => row.id === review.setId);
  return { session, set: set as Record<string, unknown> | undefined };
}

function ReviewCard({
  item,
  sessions,
  onError,
}: {
  item: WatchReviewItem;
  sessions: WorkoutSession[];
  onError: (message: string) => void;
}) {
  const { review } = item;
  const [busy, setBusy] = useState(false);
  const { session, set } = liveSet(sessions, review);
  const open = session?.status === 'inProgress' && !!set;
  // Re-read the live value: the stored one is only what it was at conflict time.
  const fields = allReviewFields(review);
  const shown = Object.fromEntries(
    fields.map((row) => [row.field, set ? (set[row.field] ?? null) : row.phone]),
  );
  // Changes that did not conflict but were held back with the op (e.g. a completion).
  const heldBack = fields.filter((row) => !row.conflict && !same(shown[row.field], row.requested));
  const run = async (keep: 'phone' | 'watch') => {
    setBusy(true);
    try {
      const outcome = await resolveReview(review.id, keep, shown);
      if (outcome === 'conflict') onError('The set changed again. Review the new values below.');
      if (outcome === 'closed') onError('This workout is closed. Its values can no longer change.');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not save your review. Retry.');
    } finally {
      setBusy(false);
    }
  };
  const source = review.origin === 'watch' ? 'Watch' : 'Your phone edit';
  return (
    <div style={{ marginBottom: 16 }}>
      <p>
        <strong>{exerciseName(review.exerciseId)}</strong> · {review.reason}
      </p>
      {fields.length > 0 && (
        <table className="tiny" style={{ width: '100%', textAlign: 'left' }}>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Phone now</th>
              <th scope="col">{source}</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((row) => (
              <tr key={row.field} className={row.conflict ? 'conflict' : undefined}>
                <th scope="row">
                  {FIELD_LABELS[row.field] ?? row.field}
                  {!row.conflict && <span className="muted"> (no conflict)</span>}
                </th>
                <td>{display(shown[row.field])}</td>
                <td>{display(row.requested)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {heldBack.length > 0 && (
        <p className="tiny" role="note">
          Keep phone values also leaves out {review.origin === 'watch' ? 'the watch’s' : 'your'}{' '}
          {heldBack
            .map((row) => `${FIELD_LABELS[row.field] ?? row.field}: ${display(row.requested)}`)
            .join(', ')}
          .
        </p>
      )}
      <div className="row tight" style={{ marginTop: 8 }}>
        <button className="btn small" disabled={busy} onClick={() => void run('phone')}>
          Keep phone values
        </button>
        {fields.length > 0 && (
          <button
            className="btn small primary"
            disabled={busy || !open}
            onClick={() => void run('watch')}
          >
            {review.origin === 'watch' ? 'Apply watch values' : 'Apply my phone edit'}
          </button>
        )}
      </div>
    </div>
  );
}

function EvidenceCard({
  item,
  sessions,
  onError,
}: {
  item: Exclude<ReviewItem, WatchReviewItem>;
  sessions: WorkoutSession[];
  onError: (message: string) => void;
}) {
  const exerciseId =
    item.kind === 'legacy' ? item.command.exerciseId : item.command.target.exerciseId;
  return (
    <div style={{ marginBottom: 16 }}>
      <p>
        <strong>{exerciseName(exerciseId)}</strong> · {item.result.reason}
      </p>
      <p className="muted tiny">
        Workout:{' '}
        {sessions.find((session) => session.id === item.command.sessionId)?.date ??
          'Removed or restored workout'}
      </p>
      <dl>
        {Object.entries(item.command.changes).map(([field, value]) => (
          <div key={field}>
            <dt>{FIELD_LABELS[field] ?? field}</dt>
            <dd>{display(value)}</dd>
          </div>
        ))}
      </dl>
      <button
        className="btn small"
        onClick={() =>
          void reviewWatchAction(item.id).catch(() => onError('Could not save your review. Retry.'))
        }
      >
        Reviewed · keep current phone values
      </button>
    </div>
  );
}

export function WatchRecovery({ sessionId }: { sessionId?: string }) {
  const actions = useLiveQuery(() => watchRecoveryActions(sessionId), [sessionId], []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), [], []);
  const [error, setError] = useState('');
  if (!actions.length) return null;
  return (
    <div className="card">
      <h3>Needs review</h3>
      <p>
        These values could not be applied because the same set changed on the other screen. Compare
        them and choose which to keep. Other sets stay usable on both screens.
      </p>
      {actions
        .slice(0, 20)
        .map((item) =>
          item.kind === 'review' ? (
            <ReviewCard key={item.id} item={item} sessions={sessions} onError={setError} />
          ) : (
            <EvidenceCard key={item.id} item={item} sessions={sessions} onError={setError} />
          ),
        )}
      {actions.length > 20 && (
        <p>Review these actions to see the remaining {actions.length - 20}.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="muted tiny">
        The original watch action remains saved after review. Applying values never overwrites a
        newer change: if the set changed again, you are asked to review it again.
      </p>
    </div>
  );
}
