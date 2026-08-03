import { Award } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { updateSettings } from '@/db/repository';
import { LineChart, type Point } from '@/components/Charts';
import {
  completedSessions,
  maxDurationForExercise,
  maxRepsForExercise,
  setReps,
  totalRepsForExercise,
} from '@/utils/stats';
import type { BandResistance } from '@/types';

const BAND_LABELS: Record<BandResistance, string> = {
  none: 'No band (unassisted)',
  extraLight: 'Extra light band',
  light: 'Light band',
  medium: 'Medium band',
  heavy: 'Heavy band',
  extraHeavy: 'Extra heavy band',
};

export default function PullUpScreen() {
  const { sessions, settings } = useAppData();
  const done = completedSessions(sessions);

  const pullUpSeries: Point[] = done
    .map((s) => ({
      label: s.date.slice(5),
      value: s.results
        .filter((r) => r.exerciseId === 'strict-pull-up')
        .flatMap((r) => r.sets.filter((x) => x.completed))
        .reduce((max, x) => Math.max(max, setReps(x)), 0),
    }))
    .filter((p) => p.value > 0);

  const currentBand = done
    .flatMap((s) => s.results.filter((r) => r.exerciseId === 'band-assisted-pull-up'))
    .flatMap((r) => r.sets)
    .map((s) => s.band)
    .filter((b): b is BandResistance => !!b)
    .pop();

  const negativeLowering = done
    .flatMap((s) => s.results.filter((r) => r.exerciseId === 'negative-pull-up'))
    .flatMap((r) => r.sets.filter((x) => x.completed))
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
            value={settings?.firstStrictPullUpDate ?? ''}
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
          <div className="value">{negativeLowering || '—'}s</div>
          <div className="label">Longest negative lowering</div>
        </div>
        <div className="stat">
          <div className="value">{maxDurationForExercise(done, 'dead-hang')}s</div>
          <div className="label">Best dead hang</div>
        </div>
        <div className="stat">
          <div className="value" style={{ fontSize: '0.95rem' }}>
            {currentBand ? BAND_LABELS[currentBand] : '—'}
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
