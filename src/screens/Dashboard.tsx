import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { PauseCircle, Play, RotateCcw, Timer, TrendingUp, Trophy } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import {
  activePause,
  createSession,
  currentDay,
  findInProgressSession,
  projectedDate,
  totalSessionsFor,
} from '@/db/repository';
import { programFor, WEEKDAY_LABELS } from '@/data/programs';
import {
  averageBackPain,
  averageKneePain,
  averageShoulderPain,
  completedSessions,
  completionPercent,
  durationTrend,
  maxDurationForExercise,
  maxRepsForExercise,
  pushUpTotal,
  round1,
  workingSetsOf,
} from '@/utils/stats';
import { bandName, lastPerformance } from '@/utils/doubleProgression';
import { PhaseBadge } from './PhaseBadge';
import { DurationMeter } from './DurationMeter';
import type { WorkoutSession } from '@/types';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const { plan, sessions, settings, suggestions } = useAppData();
  const navigate = useNavigate();
  const [unfinished, setUnfinished] = useState<WorkoutSession | undefined>();

  useEffect(() => {
    void findInProgressSession().then(setUnfinished);
  }, [sessions]);

  // Every number on this screen is about the plan being trained. `sessions` is
  // deliberately unfiltered upstream so export can see every program's history.
  const planSessions = useMemo(
    () => sessions.filter((s) => s.planId === plan?.id),
    [sessions, plan?.id],
  );

  if (!plan || !settings) return null;

  const program = programFor(plan.programId);
  // Once the block is finished there is no "today" — the cursor stays pinned to
  // the last day, which would otherwise offer that day forever.
  const day = plan.completedAt ? undefined : currentDay(plan);
  const week = plan.weeks.find((w) => w.weekNumber === plan.currentWeek);
  const done = completedSessions(planSessions);
  const total = totalSessionsFor(plan);
  const percent = completionPercent(planSessions, total);
  const pause = activePause(plan);
  const nextIndex = plan.currentDayIndex + 1;
  const upcoming =
    week?.days[nextIndex] ?? plan.weeks.find((w) => w.weekNumber === plan.currentWeek + 1)?.days[0];
  const lastDuration = durationTrend(planSessions).at(-1);
  const pending = suggestions.filter((s) => s.status === 'pending');
  const isHypertrophy = plan.programId === 'hypertrophy-14wk';

  const startToday = async () => {
    if (!day) return;
    const existing = await findInProgressSession();
    if (existing) {
      navigate(`/workout/${existing.id}`);
      return;
    }
    const session = await createSession(plan, day, settings.weightOverrides);
    navigate(`/workout/${session.id}`);
  };

  return (
    <div>
      {pause && (
        <div className="banner warn">
          <div className="row tight">
            <PauseCircle size={16} />
            <strong>Plan paused — {pause.label}</strong>
          </div>
          {pause.startDate} to {pause.endDate}. Pick the plan back up when you are home; nothing is
          locked to a calendar date.
        </div>
      )}

      {plan.completedAt && (
        <div className="banner info">
          <div className="row tight">
            <Trophy size={16} />
            <strong>{program.name} complete</strong>
          </div>
          Fill in the{' '}
          <a href="#/assessment" onClick={(e) => (e.preventDefault(), navigate('/assessment'))}>
            final assessment
          </a>{' '}
          to close out the block, or start a fresh plan from the Plan screen.
        </div>
      )}

      <div className="card">
        <div className="card-title">
          <div style={{ minWidth: 0 }}>
            <div className="week-head-meta">
              <span className="pill accent">
                Week {plan.currentWeek} of {plan.weeks.length}
              </span>
              {week && <PhaseBadge week={week} />}
            </div>
            <h2 style={{ marginTop: 6 }}>{day ? day.title : 'Plan complete'}</h2>
            <span className="muted tiny">
              {day
                ? `${WEEKDAY_LABELS[day.weekday]} · ${day.focus} · ~${day.estimatedMinutes} min`
                : (week?.focus ?? program.name)}
            </span>
            <div className="muted tiny" style={{ marginTop: 2 }}>
              {program.name}
            </div>
          </div>
        </div>

        <div className="progress-track" style={{ marginBottom: 6 }}>
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="row tight muted tiny" style={{ justifyContent: 'space-between' }}>
          <span>
            {done.length} of {total} sessions complete
          </span>
          <span>{percent}%</span>
        </div>

        <div className="divider" />

        {unfinished ? (
          <div className="stack">
            <button
              className="btn primary block"
              onClick={() => navigate(`/workout/${unfinished.id}`)}
            >
              <RotateCcw size={18} /> Resume unfinished workout
            </button>
            <span className="muted tiny">
              Started {format(new Date(unfinished.startedAt), 'EEE d MMM, HH:mm')}
            </span>
          </div>
        ) : (
          <button className="btn primary block" onClick={() => void startToday()} disabled={!day}>
            <Play size={18} /> Start today&apos;s workout
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <div className="row tight">
            <Timer size={17} />
            <h3>Last workout length</h3>
          </div>
          {lastDuration && <span className="muted tiny">{lastDuration.date}</span>}
        </div>
        {lastDuration ? (
          <DurationMeter minutes={Math.round(lastDuration.value)} />
        ) : (
          <p className="muted tiny" style={{ margin: 0 }}>
            Finish a session to see how it lands against the 45–55 minute target. The general
            warm-up is done outside the app and is not counted.
          </p>
        )}
      </div>

      {pending.length > 0 && (
        <div className="card">
          <div className="card-title">
            <div className="row tight">
              <TrendingUp size={17} />
              <h3>Ready to progress</h3>
            </div>
            <span className="pill accent">{pending.length}</span>
          </div>
          {pending.slice(0, 3).map((s) => (
            <div className="kv" key={s.id}>
              <span className="k">{s.exerciseName}</span>
              <span className="v" style={{ fontWeight: 600 }}>
                {s.recommendation}
              </span>
            </div>
          ))}
          <button
            className="btn block small"
            style={{ marginTop: 10 }}
            onClick={() => navigate('/progress')}
          >
            Review {pending.length === 1 ? 'it' : 'them'} on Progress
          </button>
          <p className="muted tiny" style={{ margin: '8px 0 0' }}>
            Nothing is applied automatically — you confirm every load change.
          </p>
        </div>
      )}

      <h3 style={{ margin: '18px 0 8px' }}>Key numbers</h3>
      <div className="grid-2">
        {isHypertrophy ? (
          <>
            <Stat label="Sessions completed" value={done.length} />
            <Stat
              label="Pull-up assistance"
              value={(() => {
                const band = lastPerformance(planSessions, 'band-assisted-pull-up')?.band;
                return band ? bandName(band, settings.bandLabels) : '—';
              })()}
            />
            <Stat
              label="Avg RIR, last session"
              value={(() => {
                const last = done.at(-1);
                if (!last) return '—';
                const values = last.results
                  .flatMap(workingSetsOf)
                  .map((s) => s.rir)
                  .filter((v): v is number => typeof v === 'number');
                return values.length
                  ? round1(values.reduce((a, b) => a + b, 0) / values.length)
                  : '—';
              })()}
            />
            <Stat label="Bodyweight" value={settings.bodyweight ?? '—'} />
          </>
        ) : (
          <>
            <Stat
              label="Strict pull-up record"
              value={maxRepsForExercise(done, 'strict-pull-up')}
            />
            <Stat label="Chin-up record" value={maxRepsForExercise(done, 'chin-up')} />
            <Stat label="Best dead hang" value={`${maxDurationForExercise(done, 'dead-hang')}s`} />
            <Stat label="Total push-ups" value={pushUpTotal(done)} />
          </>
        )}
        <Stat label="Avg knee pain" value={averageKneePain(planSessions) ?? '—'} />
        <Stat label="Avg shoulder pain" value={averageShoulderPain(planSessions) ?? '—'} />
        <Stat label="Avg lower-back pain" value={averageBackPain(planSessions) ?? '—'} />
        {isHypertrophy && <Stat label="Weeks in the plan" value={plan.weeks.length} />}
      </div>

      {upcoming && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">
            <h3>Up next</h3>
            <span className="muted tiny">
              {projectedDate(
                plan,
                upcoming.weekNumber,
                plan.weeks
                  .find((w) => w.weekNumber === upcoming.weekNumber)
                  ?.days.indexOf(upcoming) ?? 0,
              )}
            </span>
          </div>
          <strong>{program.dayLabels[upcoming.dayType]}</strong>
          <div className="muted tiny">
            Week {upcoming.weekNumber} · {WEEKDAY_LABELS[upcoming.weekday]} · {upcoming.focus}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">
          <h3>Rest days</h3>
        </div>
        <p className="muted tiny" style={{ margin: 0 }}>
          {program.daysPerWeek === 4
            ? 'Wednesday and the weekend are rest days. Walking and farm work are not tracked as workouts.'
            : 'Saturday and Sunday are rest days. Farm work is not tracked as a workout.'}
        </p>
      </div>
    </div>
  );
}
