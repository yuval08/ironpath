import { Check, Flame, Play } from 'lucide-react';
import { VideoLink } from './VideoLink';
import type { WarmUpItem } from '@/data/programs';
import type { WarmUpItemResult } from '@/types';

/**
 * The warm-up is tracked separately and does NOT count toward the workout — the
 * session timer only starts when the warm-up is finished. Programs whose general
 * warm-up happens outside the gym ship an empty list and get a start card instead
 * of an empty checklist.
 */
export function WarmUp({
  items,
  catalog = [],
  onChange,
  onFinish,
  finished,
}: {
  items: WarmUpItemResult[];
  /** The active program's warm-up definitions, for the video links. */
  catalog?: WarmUpItem[];
  onChange: (next: WarmUpItemResult[]) => void;
  onFinish: () => void;
  finished: boolean;
}) {
  const done = items.filter((i) => i.completed).length;

  if (items.length === 0) {
    if (finished) return null;
    return (
      <div className="card">
        <div className="card-title">
          <div className="row tight">
            <Flame size={17} />
            <h3>Ready to train</h3>
          </div>
        </div>
        <p className="muted tiny">
          This program's general warm-up is done before you arrive — the session timer starts when
          you tap below.
        </p>
        <button className="btn primary block" style={{ marginTop: 10 }} onClick={onFinish}>
          <Play size={17} /> Start workout
        </button>
      </div>
    );
  }

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
      <p className="muted tiny">Tracked separately — not part of the workout timer.</p>

      {items.map((item, index) => {
        const meta = catalog.find((w) => w.id === item.id);
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
