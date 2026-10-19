import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { exerciseName } from '@/data/exercises';
import { db } from '@/db/db';
import { reviewWatchAction, watchRecoveryActions } from '@/watch/recovery';

export function WatchRecovery({ sessionId }: { sessionId?: string }) {
  const actions = useLiveQuery(() => watchRecoveryActions(sessionId), [sessionId], []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), [], []);
  const [error, setError] = useState('');
  if (!actions.length) return null;
  return (
    <div className="card">
      <h3>Saved watch actions need review</h3>
      <p>
        These values were saved on your watch but could not be applied. Compare them with your
        workout. You can copy the values into an open workout after taking control on the phone.
      </p>
      {actions.slice(0, 20).map((action) => (
        <div key={action.id} style={{ marginBottom: 16 }}>
          <p>
            <strong>{exerciseName(action.command.exerciseId)}</strong> · {action.result.reason}
          </p>
          <p className="muted tiny">
            Workout:{' '}
            {sessions.find((session) => session.id === action.command.sessionId)?.date ??
              'Removed or restored workout'}
          </p>
          <dl>
            {Object.entries(action.command.changes).map(([field, value]) => (
              <div key={field}>
                <dt>
                  {(
                    {
                      completed: 'Completed',
                      reps: 'Reps',
                      repsLeft: 'Left reps',
                      repsRight: 'Right reps',
                      weight: 'Weight (workout unit)',
                      rpe: 'Effort (RPE)',
                      rir: 'Reps in reserve',
                    } as Record<string, string>
                  )[field] ?? field}
                </dt>
                <dd>{value == null ? 'Not logged' : String(value)}</dd>
              </div>
            ))}
          </dl>
          <button
            className="btn small"
            onClick={() =>
              void reviewWatchAction(action.id).catch(() =>
                setError('Could not save your review. Retry.'),
              )
            }
          >
            Reviewed · keep current phone values
          </button>
        </div>
      ))}
      {actions.length > 20 && (
        <p>Review these actions to see the remaining {actions.length - 20}.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="muted tiny">
        The original watch action remains saved after review. On the watch, choose Use phone values
        once syncing finishes.
      </p>
    </div>
  );
}
