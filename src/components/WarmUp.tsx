import { Check, Flame } from 'lucide-react';
import { WARM_UP } from '@/data/program';
import { VideoLink } from './VideoLink';
import type { WarmUpItemResult } from '@/types';

/**
 * The warm-up is tracked separately and does NOT count toward the ~60 minute
 * workout — the session timer only starts when the warm-up is finished.
 */
export function WarmUp({
  items,
  onChange,
  onFinish,
  finished,
}: {
  items: WarmUpItemResult[];
  onChange: (next: WarmUpItemResult[]) => void;
  onFinish: () => void;
  finished: boolean;
}) {
  const done = items.filter((i) => i.completed).length;

  return (
    <div className="card">
      <div className="card-title">
        <div className="row tight">
          <Flame size={17} />
          <h3>Warm-up</h3>
        </div>
        <span className="pill">
          {done}/{items.length}
        </span>
      </div>
      <p className="muted tiny">Tracked separately — not part of the ~60 minute workout.</p>

      {items.map((item, index) => {
        const meta = WARM_UP.find((w) => w.id === item.id);
        return (
          <div key={item.id} className="row tight" style={{ padding: '6px 0' }}>
            <button
              className={`check-btn ${item.completed ? 'on' : ''}`}
              aria-label={`${item.completed ? 'Uncheck' : 'Check'} ${item.label}`}
              aria-pressed={item.completed}
              onClick={() =>
                onChange(
                  items.map((i, idx) => (idx === index ? { ...i, completed: !i.completed } : i)),
                )
              }
            >
              <Check size={17} />
            </button>
            <span style={{ flex: 1, fontSize: '0.88rem' }}>{item.label}</span>
            {meta?.exerciseId && <VideoLink exerciseId={meta.exerciseId} compact iconOnly />}
          </div>
        );
      })}

      {!finished && (
        <button className="btn primary block" style={{ marginTop: 10 }} onClick={onFinish}>
          Warm-up done — start the workout
        </button>
      )}
    </div>
  );
}
