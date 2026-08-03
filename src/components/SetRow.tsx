import { Check } from 'lucide-react';
import type { EntryStyle, LoadType, SetResult } from '@/types';

interface FieldSpec {
  key: keyof SetResult;
  label: string;
  step?: number;
  placeholder?: string;
}

/**
 * Which inputs a set shows. Driven by how the exercise is measured AND whether it
 * can carry external load at all — a push-up, a pull-up or a band drill has no
 * weight to type, so that column becomes RIR instead of a dead kg box.
 */
export function canBeLoaded(loadType: LoadType): boolean {
  return (
    loadType === 'dumbbell' ||
    loadType === 'kettlebell' ||
    loadType === 'barbell' ||
    loadType === 'machine'
  );
}

export function fieldsFor(
  entryStyle: EntryStyle,
  weightLabel: string,
  loadType: LoadType = 'dumbbell',
): FieldSpec[] {
  const loaded = canBeLoaded(loadType);
  const weight: FieldSpec = { key: 'weight', label: weightLabel, step: 0.5, placeholder: 'wt' };
  const rpe: FieldSpec = { key: 'rpe', label: 'RPE', step: 0.5, placeholder: 'rpe' };
  const rir: FieldSpec = { key: 'rir', label: 'RIR', placeholder: 'rir' };

  switch (entryStyle) {
    case 'reps':
      return loaded
        ? [weight, { key: 'reps', label: 'Reps', placeholder: 'reps' }, rpe]
        : [{ key: 'reps', label: 'Reps', placeholder: 'reps' }, rpe, rir];
    case 'repsPerSide':
      return [
        { key: 'repsLeft', label: 'Left', placeholder: 'L' },
        { key: 'repsRight', label: 'Right', placeholder: 'R' },
        loaded ? weight : rpe,
      ];
    case 'time':
      return loaded
        ? [{ key: 'durationSeconds', label: 'Seconds', placeholder: 'sec' }, weight, rpe]
        : [{ key: 'durationSeconds', label: 'Seconds', placeholder: 'sec' }, rpe, rir];
    case 'timePerSide':
      return loaded
        ? [{ key: 'durationSeconds', label: 'Sec / side', placeholder: 'sec' }, weight, rpe]
        : [{ key: 'durationSeconds', label: 'Sec / side', placeholder: 'sec' }, rpe, rir];
    case 'distance':
      return loaded
        ? [{ key: 'distanceMeters', label: 'Metres', placeholder: 'm' }, weight, rpe]
        : [{ key: 'distanceMeters', label: 'Metres', placeholder: 'm' }, rpe, rir];
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
  loadType,
  showLabels,
  onChange,
  onToggle,
}: {
  set: SetResult;
  entryStyle: EntryStyle;
  weightLabel: string;
  loadType: LoadType;
  showLabels: boolean;
  onChange: (next: SetResult) => void;
  onToggle: () => void;
}) {
  const fields = fieldsFor(entryStyle, weightLabel, loadType);

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
