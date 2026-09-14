import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Check, TrendingUp, X } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { BarChart, ChartCard, LineChart, type Point } from '@/components/Charts';
import { setSuggestionStatus, totalSessionsFor } from '@/db/repository';
import { useToast } from '@/state/ToastProvider';
import {
  completedSessions,
  completionPercent,
  performedExerciseId,
  pushUpTotalForWeek,
  sessionVolume,
  setReps,
  workingSetsOf,
} from '@/utils/stats';
import { ExerciseProgressCard } from './progress/ExerciseProgressCard';
import { KeyLiftsCard } from './progress/KeyLiftsCard';
import { programFor } from '@/data/programs';
import { BandLadderCard } from './progress/BandLadderCard';
import { BodyweightCard, DurationTrendCard, RirTrendCard } from './progress/TrendCards';
import { PainFlagsCard } from './progress/PainFlagsCard';
import type { SetResult, WorkoutSession } from '@/types';

function shortLabel(session: WorkoutSession): string {
  return format(new Date(session.date), 'd/M');
}

function bestSetSeries(
  sessions: WorkoutSession[],
  exerciseId: string,
  pick: (set: SetResult) => number,
): Point[] {
  const points: Point[] = [];
  for (const session of sessions) {
    const value = session.results
      .filter((r) => performedExerciseId(r) === exerciseId && r.skippedReason == null)
      // Ramp sets are logged for context only — a heavy single would win every chart.
      .flatMap((r) => workingSetsOf(r).filter((s) => s.completed))
      .reduce((max, s) => Math.max(max, pick(s) || 0), 0);
    if (value > 0) points.push({ label: shortLabel(session), value });
  }
  return points;
}

export default function ProgressScreen() {
  const { plan, sessions, suggestions, settings } = useAppData();
  const { toast } = useToast();
  // Held here so a key-lift row can chart its exercise in the card below it.
  const [chartedLift, setChartedLift] = useState<string | null>(null);

  // Charts describe the plan you are training. `sessions` is unfiltered upstream
  // because export needs every plan's history.
  const planSessions = useMemo(
    () => sessions.filter((s) => s.planId === plan?.id),
    [sessions, plan?.id],
  );

  if (!plan || !settings) return null;

  const done = completedSessions(planSessions);
  const pending = suggestions.filter((s) => s.status === 'pending');
  const total = totalSessionsFor(plan);
  const weekNumbers = plan.weeks.map((w) => w.weekNumber);
  const isResilience = plan.programId === 'movement-resilience';

  const weeklyVolumePoints: Point[] = weekNumbers.map((week) => ({
    label: `W${week}`,
    value: Math.round(
      done.filter((s) => s.weekNumber === week).reduce((sum, s) => sum + sessionVolume(s), 0),
    ),
  }));

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

      <ChartCard title="Workout completion" subtitle={`${done.length} of ${total} sessions`}>
        <div className="progress-track" style={{ marginBottom: 8 }}>
          <div
            className="progress-fill"
            style={{ width: `${completionPercent(planSessions, total)}%` }}
          />
        </div>
        <BarChart
          points={weekNumbers.map((week) => ({
            label: `W${week}`,
            value: done.filter((s) => s.weekNumber === week).length,
          }))}
          emptyMessage="Complete a session to see your progress here."
        />
      </ChartCard>

      <KeyLiftsCard
        lifts={programFor(plan.programId).keyLifts ?? []}
        sessions={planSessions}
        unit={settings.weightUnit}
        bandLabels={settings.bandLabels}
        onSelect={(id) => {
          setChartedLift(id);
          requestAnimationFrame(() =>
            document
              .getElementById('exercise-progression')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
          );
        }}
      />

      <ExerciseProgressCard
        plan={plan}
        sessions={planSessions}
        unit={settings.weightUnit}
        bandLabels={settings.bandLabels}
        selected={chartedLift}
        onSelect={setChartedLift}
      />

      <BandLadderCard sessions={planSessions} bandLabels={settings.bandLabels} />

      <RirTrendCard sessions={planSessions} />

      <DurationTrendCard sessions={planSessions} />

      <ChartCard title="Weekly volume" subtitle="Weight × reps across completed working sets">
        <BarChart points={weeklyVolumePoints} />
      </ChartCard>

      {/* Only the resilience block trains these, and only it prescribes a weekly
          push-up target — charting them for a hypertrophy plan is empty axes. */}
      {isResilience && (
        <>
          <ChartCard title="Pull-up maximum" subtitle="Best set per session">
            <LineChart points={bestSetSeries(done, 'strict-pull-up', setReps)} suffix=" reps" />
          </ChartCard>

          <ChartCard title="Chin-up maximum" subtitle="Best set per session">
            <LineChart points={bestSetSeries(done, 'chin-up', setReps)} suffix=" reps" />
          </ChartCard>

          <ChartCard title="Push-up volume" subtitle="Total quality reps per week">
            <BarChart
              points={weekNumbers.map((week) => ({
                label: `W${week}`,
                value: pushUpTotalForWeek(done, week),
              }))}
            />
          </ChartCard>

          <ChartCard title="Dead-hang duration" subtitle="Best hang per session">
            <LineChart
              points={bestSetSeries(done, 'dead-hang', (s) => s.durationSeconds ?? 0)}
              suffix="s"
            />
          </ChartCard>

          <ChartCard title="Backward treadmill duration" subtitle="Minutes per session">
            <LineChart
              points={bestSetSeries(
                done,
                'backward-treadmill-walk',
                (s) => s.treadmillMinutes ?? 0,
              )}
              suffix=" min"
            />
          </ChartCard>

          <ChartCard title="Backward treadmill speed" subtitle="mph per session">
            <LineChart
              points={bestSetSeries(done, 'backward-treadmill-walk', (s) => s.treadmillSpeed ?? 0)}
              suffix=" mph"
            />
          </ChartCard>
        </>
      )}

      <PainFlagsCard sessions={done} />

      <BodyweightCard sessions={planSessions} unit={settings.weightUnit} />
    </div>
  );
}
