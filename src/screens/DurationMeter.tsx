/** The session-length window the programs are built around. */
export const TARGET_MINUTES_LOW = 45;
export const TARGET_MINUTES_HIGH = 55;

/** Widest reading the bar can draw before the marker would leave the track. */
const SCALE_MAX = 90;

export function durationVerdict(minutes: number): string {
  if (minutes < TARGET_MINUTES_LOW) return 'Shorter than target';
  if (minutes > TARGET_MINUTES_HIGH) return 'Longer than target';
  return 'On target';
}

/**
 * One reading against the 45-55 min band. Drawn rather than charted because a
 * single value needs the *target* beside it, not a trend — the trend lives on
 * the Progress screen.
 */
export function DurationMeter({ minutes }: { minutes: number }) {
  const pct = (value: number) => `${Math.min(100, (value / SCALE_MAX) * 100)}%`;
  return (
    <div>
      <div className="row tight" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: '1.05rem' }}>{minutes} min</strong>
        <span className="muted tiny">{durationVerdict(minutes)}</span>
      </div>
      <div
        className="duration-bar"
        role="img"
        aria-label={`${minutes} minutes, target ${TARGET_MINUTES_LOW} to ${TARGET_MINUTES_HIGH} minutes`}
      >
        <div
          className="target-band"
          style={{
            left: pct(TARGET_MINUTES_LOW),
            width: `${((TARGET_MINUTES_HIGH - TARGET_MINUTES_LOW) / SCALE_MAX) * 100}%`,
          }}
        />
        <div className="marker" style={{ left: pct(minutes) }} />
      </div>
      <div className="row tight muted tiny" style={{ justifyContent: 'space-between' }}>
        <span>0</span>
        <span>
          target {TARGET_MINUTES_LOW}–{TARGET_MINUTES_HIGH} min
        </span>
        <span>{SCALE_MAX}</span>
      </div>
    </div>
  );
}
