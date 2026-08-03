import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { PauseCircle, Play, RotateCcw, Trophy } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import {
  activePause,
  createSession,
  currentDay,
  findInProgressSession,
  projectedDate,
} from '@/db/repository';
import { DAY_LABELS, WEEKDAY_LABELS } from '@/data/program';
import {
  averageBackPain,
  averageKneePain,
  averageShoulderPain,
  completedSessions,
  completionPercent,
  maxDurationForExercise,
  maxRepsForExercise,
  pushUpTotal,
  TOTAL_SESSIONS,
} from '@/utils/stats';
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
  const { plan, sessions, settings } = useAppData();
  const navigate = useNavigate();
  const [unfinished, setUnfinished] = useState<WorkoutSession | undefined>();

  useEffect(() => {
    void findInProgressSession().then(setUnfinished);
  }, [sessions]);

  if (!plan || !settings) return null;

  const day = currentDay(plan);
  const week = plan.weeks.find((w) => w.weekNumber === plan.currentWeek);
  const done = completedSessions(sessions);
  const pause = activePause(plan);
  const nextIndex = plan.currentDayIndex + 1;
  const upcoming =
    week?.days[nextIndex] ?? plan.weeks.find((w) => w.weekNumber === plan.currentWeek + 1)?.days[0];

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
          {pause.startDate} to {pause.endDate}. After your trip, restart Week 1 and complete the
          full four-week block.
        </div>
      )}

      {plan.completedAt && (
        <div className="banner info">
          <div className="row tight">
            <Trophy size={16} />
            <strong>Four weeks complete</strong>
          </div>
          Fill in the{' '}
          <a href="#/assessment" onClick={(e) => (e.preventDefault(), navigate('/assessment'))}>
            final assessment
          </a>{' '}
          to close out the block.
        </div>
      )}

      <div className="card">
        <div className="card-title">
          <div>
            <span className="pill accent">Week {plan.currentWeek} of 4</span>
            <h2 style={{ marginTop: 6 }}>{day ? day.title : 'Plan complete'}</h2>
            <span className="muted tiny">
              {day
                ? `${WEEKDAY_LABELS[day.weekday]} · ${day.focus} · ~${day.estimatedMinutes} min`
                : week?.focus}
            </span>
          </div>
        </div>

        <div className="progress-track" style={{ marginBottom: 6 }}>
          <div className="progress-fill" style={{ width: `${completionPercent(sessions)}%` }} />
        </div>
        <div className="row tight muted tiny" style={{ justifyContent: 'space-between' }}>
          <span>
            {done.length} of {TOTAL_SESSIONS} sessions complete
          </span>
          <span>{completionPercent(sessions)}%</span>
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

      <h3 style={{ margin: '18px 0 8px' }}>Key numbers</h3>
      <div className="grid-2">
        <Stat label="Strict pull-up record" value={maxRepsForExercise(done, 'strict-pull-up')} />
        <Stat label="Chin-up record" value={maxRepsForExercise(done, 'chin-up')} />
        <Stat label="Best dead hang" value={`${maxDurationForExercise(done, 'dead-hang')}s`} />
        <Stat label="Total push-ups" value={pushUpTotal(done)} />
        <Stat label="Avg knee pain" value={averageKneePain(sessions) ?? '—'} />
        <Stat label="Avg shoulder pain" value={averageShoulderPain(sessions) ?? '—'} />
        <Stat label="Avg lower-back pain" value={averageBackPain(sessions) ?? '—'} />
        <Stat label="Sessions completed" value={done.length} />
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
          <strong>{DAY_LABELS[upcoming.dayType]}</strong>
          <div className="muted tiny">
            Week {upcoming.weekNumber} · {WEEKDAY_LABELS[upcoming.weekday]} · {upcoming.focus}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">
          <h3>Weekend</h3>
        </div>
        <p className="muted tiny" style={{ margin: 0 }}>
          Saturday and Sunday are rest days. Farm work is not tracked as a workout.
        </p>
      </div>
    </div>
  );
}
