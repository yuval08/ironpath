import { AlertTriangle } from 'lucide-react';
import { painLevel } from '@/utils/stats';
import type { PainEntry } from '@/types';

interface ScaleProps {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
}

export function PainScale({ label, value, onChange }: ScaleProps) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="row tight" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: '0.83rem', fontWeight: 700 }}>{label}</span>
        {value != null && <span className={`pill ${painLevel(value)}`}>{value}/10</span>}
      </div>
      <div className="pain-scale" role="group" aria-label={label}>
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={value === i}
            className={value === i ? `sel ${painLevel(i)}` : ''}
            onClick={() => onChange(i)}
          >
            {i}
          </button>
        ))}
      </div>
    </div>
  );
}

export const EMPTY_PAIN: PainEntry = {
  leftKnee: 0,
  rightKnee: 0,
  leftShoulder: 0,
  rightShoulder: 0,
  lowerBack: 0,
  fatigue: 0,
  comments: '',
};

const FIELDS: [keyof PainEntry, string][] = [
  ['leftKnee', 'Left knee'],
  ['rightKnee', 'Right knee'],
  ['leftShoulder', 'Left shoulder'],
  ['rightShoulder', 'Right shoulder'],
  ['lowerBack', 'Lower back'],
  ['fatigue', 'General fatigue'],
];

export function PainForm({
  value,
  onChange,
}: {
  value: PainEntry;
  onChange: (next: PainEntry) => void;
}) {
  const highest = Math.max(
    value.leftKnee,
    value.rightKnee,
    value.leftShoulder,
    value.rightShoulder,
    value.lowerBack,
  );

  return (
    <div>
      {FIELDS.map(([key, label]) => (
        <PainScale
          key={key}
          label={label}
          value={value[key] as number}
          onChange={(v) => onChange({ ...value, [key]: v })}
        />
      ))}
      {highest >= 5 && (
        <div className="banner danger">
          <div className="row tight">
            <AlertTriangle size={16} />
            <strong>Pain is at {highest}/10</strong>
          </div>
          Stop any movement that provokes it and use the programmed substitution. If the pain is
          sharp, increasing or unusual, get it assessed by a qualified professional.
        </div>
      )}
      <label className="field">
        Comments
        <textarea
          value={value.comments}
          onChange={(e) => onChange({ ...value, comments: e.target.value })}
          placeholder="Anything worth remembering about how you felt"
        />
      </label>
    </div>
  );
}
