import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { useToast } from '@/state/ToastProvider';
import { updateSettings } from '@/db/repository';
import { BAND_LADDER, bandName, type BandLabels } from '@/utils/doubleProgression';
import { DEFAULT_BAND_LABELS } from '@/types';
import type { BandResistance } from '@/types';

/** The ladder position, which is fixed, as opposed to the name, which is not. */
const RUNG_HINT: Record<BandResistance, string> = {
  extraHeavy: '1 · most',
  heavy: '2',
  medium: '3',
  light: '4',
  extraLight: '5',
  none: '6 · none',
};

/**
 * Band colours and names vary by manufacturer, so the ladder positions are fixed
 * but their names are the user's. The order shown here IS the progression order —
 * top of the list assists the most.
 */
export function BandLabelEditor() {
  const { settings } = useAppData();
  const { toast } = useToast();
  if (!settings) return null;

  const labels = settings.bandLabels;

  return (
    <div className="card">
      <div className="card-title">
        <div style={{ minWidth: 0 }}>
          <h3>Band names</h3>
          <span className="muted tiny">Most assistance first</span>
        </div>
        <button
          className="btn ghost small"
          onClick={() => {
            void updateSettings({ bandLabels: DEFAULT_BAND_LABELS }).then(() =>
              toast('Band names reset'),
            );
          }}
        >
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <p className="muted tiny" style={{ marginTop: 0 }}>
        Name these after your own bands — colour, thickness, whatever you recognise on the rack.
        Renaming them never changes the progression order. Clear a field to go back to its default
        name.
      </p>
      {BAND_LADDER.map((band) => (
        <BandLabelRow key={band} band={band} labels={labels} />
      ))}
    </div>
  );
}

function BandLabelRow({ band, labels }: { band: BandResistance; labels: BandLabels }) {
  // The RAW stored label, not the resolved one: a field the user has cleared has
  // to stay cleared while they type, and showing the fallback name in the box
  // would make it look like a name they had chosen.
  const stored = labels[band] ?? '';
  const [draft, setDraft] = useState(stored);

  // Resync when the store changes underneath us — Reset rewrites all six at once.
  useEffect(() => setDraft(stored), [stored]);

  const commit = async () => {
    const next = draft.trim();
    if (next === stored) return;
    // Storing the empty string is safe and is the honest record of "no custom
    // name": bandName resolves with `||`, so a cleared label falls back to its
    // default everywhere rather than rendering a nameless rung.
    await updateSettings({ bandLabels: { ...labels, [band]: next } });
  };

  return (
    <div className="band-label-row">
      <span className="band-key">{RUNG_HINT[band]}</span>
      <input
        aria-label={`Name for the ${band} band`}
        value={draft}
        // The name that will actually be used, so clearing the field shows the
        // fallback taking over instead of leaving the user guessing.
        placeholder={bandName(band, labels)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
      />
    </div>
  );
}
