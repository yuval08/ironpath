/**
 * Deliberately tiny dependency-free SVG charts — the brief asks for simple,
 * uncluttered visuals that stay readable on a phone.
 */

export interface Point {
  label: string;
  value: number;
}

const W = 320;
const H = 120;
const PAD_L = 26;
const PAD_B = 18;
const PAD_T = 8;
const PAD_R = 8;

function scale(points: Point[], forcedMax?: number) {
  const values = points.map((p) => p.value);
  const max = Math.max(forcedMax ?? 0, ...values, 1);
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  return {
    max,
    x: (i: number) => PAD_L + (points.length > 1 ? i * step : innerW / 2),
    y: (v: number) => PAD_T + innerH - (v / max) * innerH,
  };
}

function Empty({ message }: { message: string }) {
  return <p className="muted tiny">{message}</p>;
}

export function LineChart({
  points,
  max,
  suffix = '',
  emptyMessage = 'No data yet.',
}: {
  points: Point[];
  max?: number;
  suffix?: string;
  emptyMessage?: string;
}) {
  if (points.length === 0) return <Empty message={emptyMessage} />;
  const s = scale(points, max);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${s.x(i)},${s.y(p.value)}`).join(' ');

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart">
      <line className="chart-axis" x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} />
      <line className="chart-axis" x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} />
      <text className="chart-label" x={2} y={PAD_T + 8}>
        {s.max}
        {suffix}
      </text>
      <text className="chart-label" x={2} y={H - PAD_B}>
        0
      </text>
      {points.length > 1 && <path className="chart-line" d={path} />}
      {points.map((p, i) => (
        <circle
          key={`${p.label}-${i}`}
          className="chart-dot"
          cx={s.x(i)}
          cy={s.y(p.value)}
          r={2.8}
        />
      ))}
      {points.map((p, i) =>
        i % Math.ceil(points.length / 6) === 0 ? (
          <text
            key={`l-${p.label}-${i}`}
            className="chart-label"
            x={s.x(i)}
            y={H - 5}
            textAnchor="middle"
          >
            {p.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function BarChart({
  points,
  suffix = '',
  emptyMessage = 'No data yet.',
}: {
  points: Point[];
  suffix?: string;
  emptyMessage?: string;
}) {
  if (points.length === 0) return <Empty message={emptyMessage} />;
  const s = scale(points);
  const innerW = W - PAD_L - PAD_R;
  const barW = Math.max(6, (innerW / points.length) * 0.62);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart">
      <line className="chart-axis" x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} />
      <text className="chart-label" x={2} y={PAD_T + 8}>
        {Math.round(s.max)}
        {suffix}
      </text>
      {points.map((p, i) => {
        const x = PAD_L + (innerW / points.length) * (i + 0.5) - barW / 2;
        const y = s.y(p.value);
        return (
          <g key={`${p.label}-${i}`}>
            <rect
              className="chart-bar"
              x={x}
              y={y}
              width={barW}
              height={Math.max(1, H - PAD_B - y)}
              rx={3}
            />
            <text className="chart-label" x={x + barW / 2} y={H - 5} textAnchor="middle">
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-title">
        <div>
          <h3>{title}</h3>
          {subtitle && <span className="muted tiny">{subtitle}</span>}
        </div>
      </div>
      {children}
    </div>
  );
}
