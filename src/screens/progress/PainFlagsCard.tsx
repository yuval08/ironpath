import { AlertTriangle } from 'lucide-react';
import { ChartCard, LineChart, type Point } from '@/components/Charts';
import { round1 } from '@/utils/stats';
import type { PainEntry, WorkoutSession } from '@/types';

/** How far above its own trailing mean a joint has to run before it is flagged. */
const MATERIAL_RISE = 1.5;
/** Below this the rise is noise on a scale that starts at zero. */
const MIN_ABSOLUTE = 3;
/** A trailing average needs a trail — fewer readings than this says nothing. */
const MIN_READINGS = 4;

type Joint = { label: string; keys: (keyof PainEntry)[] };

const JOINTS: Joint[] = [
  { label: 'Knee', keys: ['leftKnee', 'rightKnee'] },
  { label: 'Shoulder', keys: ['leftShoulder', 'rightShoulder'] },
  { label: 'Lower back', keys: ['lowerBack'] },
];

/** One reading per session: the after-session entry, or the before one if that is all there is. */
function series(sessions: WorkoutSession[], keys: (keyof PainEntry)[]): Point[] {
  const out: Point[] = [];
  for (const session of sessions) {
    const entry = session.painAfter ?? session.painBefore;
    if (!entry) continue;
    const values = keys.map((k) => entry[k]).filter((v): v is number => typeof v === 'number');
    if (values.length === 0) continue;
    const [, m, d] = session.date.split('-');
    out.push({
      label: `${Number(d)}/${Number(m)}`,
      value: round1(values.reduce((a, b) => a + b, 0) / values.length),
    });
  }
  return out;
}

/** Latest reading measured against the mean of everything before it. */
function flagFor(points: Point[]): { latest: number; trailing: number } | null {
  if (points.length < MIN_READINGS) return null;
  const latest = points[points.length - 1]?.value ?? 0;
  const earlier = points.slice(0, -1).map((p) => p.value);
  const trailing = round1(earlier.reduce((a, b) => a + b, 0) / earlier.length);
  if (latest < MIN_ABSOLUTE || latest - trailing < MATERIAL_RISE) return null;
  return { latest, trailing };
}

/**
 * Descriptive only. The app compares a joint against its OWN trailing average and
 * says so plainly — it never names a condition, never suggests a cause and never
 * tells the user to stop training.
 */
export function PainFlagsCard({ sessions }: { sessions: WorkoutSession[] }) {
  const rows = JOINTS.map((joint) => {
    const points = series(sessions, joint.keys);
    return { joint, points, flag: flagFor(points) };
  });

  return (
    <>
      {rows.some((r) => r.flag) && (
        <div className="card">
          <div className="card-title">
            <div className="row tight">
              <AlertTriangle size={17} />
              <h3>Worth watching</h3>
            </div>
          </div>
          {rows
            .filter((r) => r.flag)
            .map(({ joint, flag }) => (
              <div className="pain-flag" key={joint.label}>
                <AlertTriangle size={15} aria-hidden />
                <span>
                  {joint.label}: last session scored {flag!.latest}, against a trailing average of{' '}
                  {flag!.trailing}.
                </span>
              </div>
            ))}
          <p className="muted tiny" style={{ margin: '10px 0 0' }}>
            This is your own recorded number moving, nothing more — the app cannot tell you why.
            Consider easing the load on that movement and, if it keeps rising, ask a clinician.
          </p>
        </div>
      )}

      {rows.map(({ joint, points }) => (
        <ChartCard
          key={joint.label}
          title={`${joint.label} pain trend`}
          subtitle={joint.keys.length > 1 ? 'Average of both sides, per session' : 'Per session'}
        >
          <LineChart points={points} max={10} emptyMessage="No pain scores logged yet." />
        </ChartCard>
      ))}
    </>
  );
}
