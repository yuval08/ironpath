import { ChartCard, LineChart, type Point } from '@/components/Charts';
import { bodyweightRollingAverage, durationTrend, rirTrend, type TrendPoint } from '@/utils/stats';
import { TARGET_MINUTES_HIGH, TARGET_MINUTES_LOW } from '../DurationMeter';
import type { WorkoutSession } from '@/types';

function toPoints(trend: TrendPoint[]): Point[] {
  return trend.map((t) => {
    const [, m, d] = t.date.split('-');
    return { label: `${Number(d)}/${Number(m)}`, value: t.value };
  });
}

/** Mean reps-in-reserve per session — how hard the sessions are actually run. */
export function RirTrendCard({ sessions }: { sessions: WorkoutSession[] }) {
  return (
    <ChartCard title="RIR trend" subtitle="Average reps in reserve per session">
      <LineChart
        points={toPoints(rirTrend(sessions))}
        max={5}
        emptyMessage="Log RIR on a working set to chart it."
      />
      <p className="muted tiny" style={{ margin: '8px 0 0' }}>
        Lower is harder. A rising line across several sessions usually means the loads have stopped
        keeping up with you.
      </p>
    </ChartCard>
  );
}

export function DurationTrendCard({ sessions }: { sessions: WorkoutSession[] }) {
  const points = toPoints(durationTrend(sessions));
  const overruns = points.filter((p) => p.value > TARGET_MINUTES_HIGH).length;
  return (
    <ChartCard
      title="Workout duration"
      subtitle={`Active minutes per session · target ${TARGET_MINUTES_LOW}–${TARGET_MINUTES_HIGH}`}
    >
      <LineChart
        points={points}
        suffix=" min"
        emptyMessage="Finish a session to chart its length."
      />
      {overruns > 0 && (
        <p className="muted tiny" style={{ margin: '8px 0 0' }}>
          {overruns} of {points.length} sessions ran past {TARGET_MINUTES_HIGH} minutes. The split
          squat is the documented first set to drop if this keeps happening.
        </p>
      )}
    </ChartCard>
  );
}

/**
 * Raw weigh-ins alongside their 7-day rolling mean. The raw line alone is mostly
 * water; the average alone hides the readings it was built from.
 */
export function BodyweightCard({ sessions, unit }: { sessions: WorkoutSession[]; unit: string }) {
  const rolling = toPoints(bodyweightRollingAverage(sessions, 7));
  const raw: Point[] = sessions
    .filter((s) => typeof s.bodyweight === 'number')
    .map((s) => {
      const [, m, d] = s.date.split('-');
      return { label: `${Number(d)}/${Number(m)}`, value: s.bodyweight as number };
    });

  return (
    <ChartCard title="Bodyweight" subtitle={`7-day rolling average · ${unit}`}>
      <LineChart
        points={rolling}
        suffix={` ${unit}`}
        emptyMessage="Log bodyweight during a session to chart it."
      />
      {raw.length > 0 && (
        <>
          <div className="muted tiny" style={{ marginTop: 10 }}>
            Individual weigh-ins
          </div>
          <LineChart points={raw} suffix={` ${unit}`} />
        </>
      )}
      <p className="muted tiny" style={{ margin: '8px 0 0' }}>
        Tracked for context only — it never feeds a progression decision.
      </p>
    </ChartCard>
  );
}
