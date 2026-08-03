import { ShieldAlert } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { updateSettings } from '@/db/repository';

export const DISCLAIMER_TEXT =
  'This app is a workout tracking tool and does not provide medical diagnosis. Stop any exercise that causes sharp, worsening, or unusual pain. Seek evaluation from a qualified medical professional when needed.';

/** Shown once until acknowledged — never repeated during a workout. */
export function Disclaimer() {
  const { settings } = useAppData();
  if (!settings || settings.disclaimerAcknowledged) return null;

  return (
    <div className="card">
      <div className="row tight" style={{ marginBottom: 8 }}>
        <ShieldAlert size={18} />
        <strong>Before you start</strong>
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>
        {DISCLAIMER_TEXT}
      </p>
      <button
        className="btn primary block"
        onClick={() => void updateSettings({ disclaimerAcknowledged: true })}
      >
        Got it
      </button>
    </div>
  );
}

export function DisclaimerText() {
  return <p className="muted tiny">{DISCLAIMER_TEXT}</p>;
}
