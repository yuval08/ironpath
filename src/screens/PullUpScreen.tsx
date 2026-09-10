import { Award } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { updateSettings } from '@/db/repository';
import { LineChart, type Point } from '@/components/Charts';
import {
  completedSessions,
  performedExerciseId,
  maxDurationForExercise,
  maxRepsForExercise,
  setReps,
  totalRepsForExercise,
  workingSetsOf,
} from '@/utils/stats';
import {
  bandName,
  formatPerformance,
  lastPerformance,
  nextLighterBand,
  performanceHistory,
} from '@/utils/doubleProgression';
import { BandLadderCard } from './progress/BandLadderCard';
import type { BandResistance, UserSettings, WorkoutSession } from '@/types';

/**
 * Two different goals live behind one route. The resilience block is chasing a
 * first strict pull-up, so it tracks singles and dead hangs. The hypertrophy
 * program deliberately never prescribes a strict pull-up or a max-rep test — its
 * whole pull-up progression is walking down the assistance ladder — so asking it
 * to report a strict-pull-up record would be asking for a rep that does not exist.
 */
export default function PullUpScreen() {
  const { plan, sessions, settings } = useAppData();
  if (!plan || !settings) return null;

  const planSessions = sessions.filter((s) => s.planId === plan.id);
  return plan.programId === 'hypertrophy-14wk' ? (
    <AssistedPullUpView sessions={planSessions} settings={settings} />
  ) : (
    <StrictPullUpView sessions={planSessions} settings={settings} />
  );
}

function AssistedPullUpView({
  sessions,
  settings,
}: {
  sessions: WorkoutSession[];
  settings: UserSettings;
}) {
  const done = completedSessions(sessions);
  const history = performanceHistory(done, 'band-assisted-pull-up');
  const last = lastPerformance(done, 'band-assisted-pull-up');
  const currentBand = last?.band ?? null;
  const nextBand = currentBand ? nextLighterBand(currentBand) : null;

  const repSeries: Point[] = history
    .filter((h) => h.reps.length > 0)
    .map((h) => {
      const [, m, d] = h.date.split('-');
      return { label: `${Number(d)}/${Number(m)}`, value: Math.max(...h.reps) };
    });

  const totalReps = totalRepsForExercise(done, 'band-assisted-pull-up');
  const scapSessions = done.filter((s) =>
    s.results.some((r) => performedExerciseId(r) === 'scapular-pull-up'),
  ).length;

  return (
    <div>
      <div className="card">
        <div className="row tight" style={{ marginBottom: 8 }}>
          <Award size={18} />
          <h2>Pull-up progression</h2>
        </div>
        <div className="banner info">
          Progress here is <strong>less assistance</strong>, not more reps at any cost. Own 6–10
          clean reps on every working set at your current band, then move one band lighter. This
          program never asks you to test a strict pull-up.
        </div>
      </div>

      <div className="grid-2">
        <div className="stat">
          <div className="value" style={{ fontSize: '0.95rem' }}>
            {currentBand ? bandName(currentBand, settings.bandLabels) : '—'}
          </div>
          <div className="label">Current band</div>
        </div>
        <div className="stat">
          <div className="value" style={{ fontSize: '0.95rem' }}>
            {nextBand ? bandName(nextBand, settings.bandLabels) : '—'}
          </div>
          <div className="label">Next rung down</div>
        </div>
        <div className="stat">
          <div className="value">{maxRepsForExercise(done, 'band-assisted-pull-up')}</div>
          <div className="label">Best set</div>
        </div>
        <div className="stat">
          <div className="value">{totalReps}</div>
          <div className="label">Total assisted reps</div>
        </div>
      </div>

      <BandLadderCard sessions={done} bandLabels={settings.bandLabels} />

      <div className="card">
        <div className="card-title">
          <h3>Last logged set</h3>
        </div>
        <p style={{ margin: 0, fontSize: '0.9rem' }}>
          {formatPerformance(last, settings.weightUnit, settings.bandLabels)}
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Best set per session</h3>
          <span className="pill">{scapSessions} scapular sessions</span>
        </div>
        <LineChart
          points={repSeries}
          suffix=" reps"
          emptyMessage="Log an assisted pull-up set to start the chart."
        />
        <p className="muted tiny" style={{ margin: '8px 0 0' }}>
          Reps drop after a band change — that is the progression working, not a setback.
        </p>
      </div>
    </div>
  );
}

function StrictPullUpView({
  sessions,
  settings,
}: {
  sessions: WorkoutSession[];
  settings: UserSettings;
}) {
  const done = completedSessions(sessions);

  const pullUpSeries: Point[] = done
    .map((s) => ({
      label: s.date.slice(5),
      value: s.results
        .filter((r) => performedExerciseId(r) === 'strict-pull-up' && r.skippedReason == null)
        .flatMap((r) => workingSetsOf(r).filter((x) => x.completed))
        .reduce((max, x) => Math.max(max, setReps(x)), 0),
    }))
    .filter((p) => p.value > 0);

  const currentBand = done
    .flatMap((s) => s.results.filter((r) => performedExerciseId(r) === 'band-assisted-pull-up'))
    .flatMap((r) => workingSetsOf(r))
    .map((s) => s.band)
    .filter((b): b is BandResistance => !!b)
    .pop();

  const negativeLowering = done
    .flatMap((s) => s.results.filter((r) => performedExerciseId(r) === 'negative-pull-up'))
    .flatMap((r) => workingSetsOf(r).filter((x) => x.completed))
    .reduce((max, x) => Math.max(max, x.durationSeconds ?? 0), 0);

  const scapQuality = (() => {
    const results = done.flatMap((s) =>
      s.results.filter((r) => r.exerciseId === 'scapular-pull-up'),
    );
    if (results.length === 0) return '—';
    const good = results.filter((r) => r.formGood === true).length;
    return `${good}/${results.length} sessions clean`;
  })();

  return (
    <div>
      <div className="card">
        <div className="row tight" style={{ marginBottom: 8 }}>
          <Award size={18} />
          <h2>Pull-up goal</h2>
        </div>
        <div className="banner info">
          <strong>Target, not a promise:</strong> 3-5 clean consecutive strict pull-ups by the end
          of the block. Progress here depends on recovery, bodyweight and consistency — treat it as
          a direction, not a guarantee.
        </div>
        <label className="field">
          Date of your first strict pull-up
          <input
            type="date"
            value={settings.firstStrictPullUpDate ?? ''}
            onChange={(e) => void updateSettings({ firstStrictPullUpDate: e.target.value || null })}
          />
        </label>
      </div>

      <div className="grid-2">
        <div className="stat">
          <div className="value">{maxRepsForExercise(done, 'strict-pull-up')}</div>
          <div className="label">Max strict pull-ups</div>
        </div>
        <div className="stat">
          <div className="value">{totalRepsForExercise(done, 'strict-pull-up')}</div>
          <div className="label">Total strict pull-ups</div>
        </div>
        <div className="stat">
          <div className="value">{maxRepsForExercise(done, 'chin-up')}</div>
          <div className="label">Max chin-ups</div>
        </div>
        <div className="stat">
          <div className="value">{negativeLowering ? `${negativeLowering}s` : '—'}</div>
          <div className="label">Longest negative lowering</div>
        </div>
        <div className="stat">
          <div className="value">{maxDurationForExercise(done, 'dead-hang')}s</div>
          <div className="label">Best dead hang</div>
        </div>
        <div className="stat">
          <div className="value" style={{ fontSize: '0.95rem' }}>
            {currentBand ? bandName(currentBand, settings.bandLabels) : '—'}
          </div>
          <div className="label">Band assistance</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title">
          <h3>Scapular pull-up quality</h3>
          <span className="pill">{scapQuality}</span>
        </div>
        <p className="muted tiny" style={{ margin: 0 }}>
          Marked from the &quot;Clean / Broke down&quot; form rating you give during each session.
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Strict pull-up progress</h3>
        </div>
        <LineChart
          points={pullUpSeries}
          suffix=" reps"
          emptyMessage="Log a pull-up set to start the chart."
        />
      </div>
    </div>
  );
}
