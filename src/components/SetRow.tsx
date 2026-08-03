import { Check } from 'lucide-react';
import type { EntryStyle, SetResult } from '@/types';

interface FieldSpec {
  key: keyof SetResult;
  label: string;
  step?: number;
  placeholder?: string;
}

/** The three inputs a set shows depend on how the exercise is measured. */
export function fieldsFor(entryStyle: EntryStyle, weightLabel: string): FieldSpec[] {
  switch (entryStyle) {
    case 'reps':
      return [
        { key: 'weight', label: weightLabel, step: 0.5, placeholder: 'wt' },
        { key: 'reps', label: 'Reps', placeholder: 'reps' },
        { key: 'rpe', label: 'RPE', step: 0.5, placeholder: 'rpe' },
      ];
    case 'repsPerSide':
      return [
        { key: 'repsLeft', label: 'Left', placeholder: 'L' },
        { key: 'repsRight', label: 'Right', placeholder: 'R' },
        { key: 'weight', label: weightLabel, step: 0.5, placeholder: 'wt' },
      ];
    case 'time':
      return [
        { key: 'durationSeconds', label: 'Seconds', placeholder: 'sec' },
        { key: 'weight', label: weightLabel, step: 0.5, placeholder: 'wt' },
        { key: 'rpe', label: 'RPE', step: 0.5, placeholder: 'rpe' },
      ];
    case 'timePerSide':
      return [
        { key: 'durationSeconds', label: 'Sec / side', placeholder: 'sec' },
        { key: 'weight', label: weightLabel, step: 0.5, placeholder: 'wt' },
        { key: 'rpe', label: 'RPE', step: 0.5, placeholder: 'rpe' },
      ];
    case 'distance':
      return [
        { key: 'distanceMeters', label: 'Metres', placeholder: 'm' },
        { key: 'weight', label: weightLabel, step: 0.5, placeholder: 'wt' },
        { key: 'rpe', label: 'RPE', step: 0.5, placeholder: 'rpe' },
      ];
    case 'stepsPerDirection':
      return [
        { key: 'reps', label: 'Steps / way', placeholder: 'steps' },
        { key: 'rpe', label: 'RPE', step: 0.5, placeholder: 'rpe' },
        { key: 'rir', label: 'RIR', placeholder: 'rir' },
      ];
    case 'treadmill':
      return [
        { key: 'treadmillMinutes', label: 'Minutes', step: 0.5, placeholder: 'min' },
        { key: 'treadmillSpeed', label: 'Speed (mph)', step: 0.1, placeholder: 'mph' },
        { key: 'treadmillIncline', label: 'Incline %', step: 0.5, placeholder: 'inc' },
      ];
    default:
      return [];
  }
}

export function SetRow({
  set,
  entryStyle,
  weightLabel,
  showLabels,
  onChange,
  onToggle,
}: {
  set: SetResult;
  entryStyle: EntryStyle;
  weightLabel: string;
  showLabels: boolean;
  onChange: (next: SetResult) => void;
  onToggle: () => void;
}) {
  const fields = fieldsFor(entryStyle, weightLabel);

  return (
    <>
      {showLabels && (
        <div className="set-row" aria-hidden>
          <span />
          {fields.map((f) => (
            <span key={f.key} className="muted tiny" style={{ textAlign: 'center' }}>
              {f.label}
            </span>
          ))}
          <span />
        </div>
      )}
      <div className="set-row">
        <span className="set-no">{set.setNumber}</span>
        {fields.map((f) => (
          <input
            key={f.key}
            type="number"
            inputMode="decimal"
            step={f.step ?? 1}
            min={0}
            aria-label={`Set ${set.setNumber} ${f.label}`}
            placeholder={f.placeholder}
            value={(set[f.key] as number | null) ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              const value = raw === '' ? null : Number(raw);
              onChange({ ...set, [f.key]: value === null || Number.isNaN(value) ? null : value });
            }}
          />
        ))}
        <button
          type="button"
          className={`check-btn ${set.completed ? 'on' : ''}`}
          aria-label={`Mark set ${set.setNumber} ${set.completed ? 'incomplete' : 'complete'}`}
          aria-pressed={set.completed}
          onClick={onToggle}
        >
          <Check size={18} />
        </button>
      </div>
    </>
  );
}
