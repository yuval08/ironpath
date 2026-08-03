import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { removePause, setPauseActive, upsertPause } from '@/db/repository';

/** Pause windows (travel, illness) that the projected schedule skips over. */
export function PauseManager() {
  const { plan } = useAppData();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  if (!plan) return null;

  const add = async () => {
    if (!label || !start || !end) return;
    await upsertPause({ label, startDate: start, endDate: end, active: true });
    setLabel('');
    setStart('');
    setEnd('');
    setAdding(false);
  };

  return (
    <div className="card">
      <div className="card-title">
        <h3>Pause periods</h3>
        <button className="btn ghost small" onClick={() => setAdding((a) => !a)}>
          <Plus size={15} /> Add
        </button>
      </div>

      {plan.pausePeriods.length === 0 && <p className="muted tiny">No pauses scheduled.</p>}

      {plan.pausePeriods.map((p) => (
        <div className="row tight" key={p.id} style={{ padding: '6px 0' }}>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: '0.9rem' }}>{p.label}</strong>
            <div className="muted tiny">
              {p.startDate} → {p.endDate}
            </div>
          </div>
          <label className="row tight tiny" style={{ gap: 5 }}>
            <input
              type="checkbox"
              style={{ width: 'auto', minHeight: 'auto' }}
              checked={p.active}
              onChange={(e) => void setPauseActive(p.id, e.target.checked)}
            />
            Active
          </label>
          <button
            className="btn ghost small icon"
            aria-label={`Remove ${p.label}`}
            onClick={() => void removePause(p.id)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {adding && (
        <div className="stack" style={{ marginTop: 10 }}>
          <label className="field">
            Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Travel" />
          </label>
          <div className="grid-2">
            <label className="field">
              From
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="field">
              To
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <button className="btn primary block" onClick={() => void add()}>
            Save pause
          </button>
        </div>
      )}
    </div>
  );
}
