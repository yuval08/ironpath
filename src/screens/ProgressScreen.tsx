import { format } from 'date-fns';
import { Check, TrendingUp, X } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { BarChart, ChartCard, LineChart, type Point } from '@/components/Charts';
import { setSuggestionStatus } from '@/db/repository';
import { useToast } from '@/state/ToastProvider';
import {
  averageRpe,
  completedSessions,
  completionPercent,
  performedExerciseId,
  pushUpTotalForWeek,
  sessionVolume,
  setReps,
  TOTAL_SESSIONS,
} from '@/utils/stats';
import type { WorkoutSession } from '@/types';

function shortLabel(session: WorkoutSession): string {
  return format(new Date(session.date), 'd/M');
}

function bestSetSeries(
  sessions: WorkoutSession[],
  exerciseId: string,
  pick: (set: WorkoutSession['results'][number]['sets'][number]) => number,
): Point[] {
  const points: Point[] = [];
  for (const session of sessions) {
    const value = session.results
      .filter((r) => performedExerciseId(r) === exerciseId && r.skippedReason == null)
      .flatMap((r) => r.sets.filter((s) => s.completed))
      .reduce((max, s) => Math.max(max, pick(s) || 0), 0);
    if (value > 0) points.push({ label: shortLabel(session), value });
  }
  return points;
}

function painSeries(
  sessions: WorkoutSession[],
  keys: ('leftKnee' | 'rightKnee' | 'leftShoulder' | 'rightShoulder' | 'lowerBack')[],
): Point[] {
  return sessions
    .filter((s) => s.painAfter)
    .map((s) => {
      const entry = s.painAfter!;
      const values = keys.map((k) => entry[k]);
      return {
        label: shortLabel(s),
        value: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
      };
    });
}

export default function ProgressScreen() {
  const { sessions, suggestions, settings } = useAppData();
  const { toast } = useToast();
  const done = completedSessions(sessions);
  const pending = suggestions.filter((s) => s.status === 'pending');

  const weeklyVolumePoints: Point[] = [1, 2, 3, 4].map((week) => ({
    label: `W${week}`,
    value: Math.round(
      done.filter((s) => s.weekNumber === week).reduce((sum, s) => sum + sessionVolume(s), 0),
    ),
  }));

  const pushUpPoints: Point[] = [1, 2, 3, 4].map((week) => ({
    label: `W${week}`,
    value: pushUpTotalForWeek(done, week),
  }));

  const rpePoints: Point[] = done
    .map((s) => ({ label: shortLabel(s), value: averageRpe(s) ?? 0 }))
    .filter((p) => p.value > 0);

  const bodyweightPoints: Point[] = done
    .filter((s) => s.bodyweight != null)
    .map((s) => ({ label: shortLabel(s), value: s.bodyweight as number }));

  return (
    <div>
      {pending.length > 0 && (
        <div className="card">
          <div className="card-title">
            <div className="row tight">
              <TrendingUp size={17} />
              <h3>Progression suggestions</h3>
            </div>
            <span className="pill accent">{pending.length}</span>
          </div>
          <p className="muted tiny">
            Nothing changes automatically — accept a suggestion only if it still feels right.
          </p>
          {pending.map((s) => (
            <div
              key={s.id}
              style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}
            >
              <strong style={{ fontSize: '0.92rem' }}>{s.exerciseName}</strong>
              <p className="muted tiny" style={{ margin: '3px 0' }}>
                {s.reason}
              </p>
              <p style={{ fontSize: '0.88rem', margin: '3px 0 8px' }}>{s.recommendation}</p>
              <div className="row tight">
                <button
                  className="btn primary small"
                  onClick={() => {
                    void setSuggestionStatus(s.id, 'accepted');
                    toast('Suggestion accepted — apply it in your next session');
                  }}
                >
                  <Check size={14} /> Accept
                </button>
                <button
                  className="btn ghost small"
                  onClick={() => void setSuggestionStatus(s.id, 'dismissed')}
                >
                  <X size={14} /> Not yet
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ChartCard
        title="Workout completion"
        subtitle={`${done.length} of ${TOTAL_SESSIONS} sessions`}
      >
        <div className="progress-track" style={{ marginBottom: 8 }}>
          <div className="progress-fill" style={{ width: `${completionPercent(sessions)}%` }} />
        </div>
        <BarChart
          points={[1, 2, 3, 4].map((week) => ({
            label: `W${week}`,
            value: done.filter((s) => s.weekNumber === week).length,
          }))}
          emptyMessage="Complete a session to see your progress here."
        />
      </ChartCard>

      <ChartCard title="Pull-up maximum" subtitle="Best set per session">
        <LineChart points={bestSetSeries(done, 'strict-pull-up', setReps)} suffix=" reps" />
      </ChartCard>

      <ChartCard title="Chin-up maximum" subtitle="Best set per session">
        <LineChart points={bestSetSeries(done, 'chin-up', setReps)} suffix=" reps" />
      </ChartCard>

      <ChartCard title="Push-up volume" subtitle="Total quality reps per week">
        <BarChart points={pushUpPoints} />
      </ChartCard>

      <ChartCard title="Dead-hang duration" subtitle="Best hang per session">
        <LineChart
          points={bestSetSeries(done, 'dead-hang', (s) => s.durationSeconds ?? 0)}
          suffix="s"
        />
      </ChartCard>

      <ChartCard title="Backward treadmill duration" subtitle="Minutes per session">
        <LineChart
          points={bestSetSeries(done, 'backward-treadmill-walk', (s) => s.treadmillMinutes ?? 0)}
          suffix=" min"
        />
      </ChartCard>

      <ChartCard title="Backward treadmill speed" subtitle="mph per session">
        <LineChart
          points={bestSetSeries(done, 'backward-treadmill-walk', (s) => s.treadmillSpeed ?? 0)}
          suffix=" mph"
        />
      </ChartCard>

      <ChartCard title="Knee pain trend" subtitle="Average of both knees, after each session">
        <LineChart points={painSeries(done, ['leftKnee', 'rightKnee'])} max={10} />
      </ChartCard>

      <ChartCard title="Shoulder pain trend" subtitle="Average of both shoulders">
        <LineChart points={painSeries(done, ['leftShoulder', 'rightShoulder'])} max={10} />
      </ChartCard>

      <ChartCard title="Lower-back pain trend">
        <LineChart points={painSeries(done, ['lowerBack'])} max={10} />
      </ChartCard>

      <ChartCard title="Bodyweight" subtitle={settings?.weightUnit ?? 'kg'}>
        <LineChart
          points={bodyweightPoints}
          emptyMessage="Log bodyweight during a session to chart it."
        />
      </ChartCard>

      <ChartCard title="Average RPE" subtitle="Per session">
        <LineChart points={rpePoints} max={10} />
      </ChartCard>

      <ChartCard title="Weekly volume" subtitle="Weight × reps across completed sets">
        <BarChart points={weeklyVolumePoints} />
      </ChartCard>
    </div>
  );
}
