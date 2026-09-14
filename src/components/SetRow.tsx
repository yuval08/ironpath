import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import type { EntryStyle, LoadType, SetResult } from '@/types';

interface FieldSpec {
  key: keyof SetResult;
  label: string;
  step?: number;
  placeholder?: string;
}

/** Fields that echo last time's value as their placeholder. */
const HINTED: ReadonlySet<keyof SetResult> = new Set(['weight', 'reps', 'repsLeft', 'repsRight']);

/**
 * Applies one typed value to a set. Per-side reps are usually equal, so the left
 * value fills the right until the right has been given its own — one number to
 * type instead of two, without ever overwriting a side the user set deliberately.
 */
export function applyField(set: SetResult, key: keyof SetResult, value: number | null): SetResult {
  const next = { ...set, [key]: value };
  if (key === 'repsLeft' && (set.repsRight == null || set.repsRight === set.repsLeft)) {
    next.repsRight = value;
  }
  return next;
}

/** Which effort scale the exercise is logged against. */
export type EffortField = 'rpe' | 'rir';

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
  effort: EffortField = 'rpe',
): FieldSpec[] {
  const loaded = canBeLoaded(loadType);
  const weight: FieldSpec = { key: 'weight', label: weightLabel, step: 0.5, placeholder: 'wt' };
  const rpe: FieldSpec = { key: 'rpe', label: 'RPE', step: 0.5, placeholder: 'rpe' };
  const rir: FieldSpec = { key: 'rir', label: 'RIR', placeholder: 'rir' };
  // A loaded set used to lose its effort column to the weight box, which made the
  // whole hypertrophy program — prescribed in RIR — impossible to record.
  const effortField = effort === 'rir' ? rir : rpe;

  switch (entryStyle) {
    case 'reps':
      if (loaded) return [weight, { key: 'reps', label: 'Reps', placeholder: 'reps' }, effortField];
      // An RIR-prescribed bodyweight or band exercise has no use for an RPE column —
      // it is the band pull-up's one wasted box. The resilience block keeps both.
      return effort === 'rir'
        ? [{ key: 'reps', label: 'Reps', placeholder: 'reps' }, rir]
        : [{ key: 'reps', label: 'Reps', placeholder: 'reps' }, rpe, rir];
    case 'repsPerSide':
      return loaded
        ? [
            { key: 'repsLeft', label: 'Left', placeholder: 'L' },
            { key: 'repsRight', label: 'Right', placeholder: 'R' },
            weight,
            effortField,
          ]
        : [
            { key: 'repsLeft', label: 'Left', placeholder: 'L' },
            { key: 'repsRight', label: 'Right', placeholder: 'R' },
            effortField,
          ];
    case 'time':
      return loaded
        ? [{ key: 'durationSeconds', label: 'Seconds', placeholder: 'sec' }, weight, effortField]
        : [{ key: 'durationSeconds', label: 'Seconds', placeholder: 'sec' }, rpe, rir];
    case 'timePerSide':
      return loaded
        ? [{ key: 'durationSeconds', label: 'Sec / side', placeholder: 'sec' }, weight, effortField]
        : [{ key: 'durationSeconds', label: 'Sec / side', placeholder: 'sec' }, rpe, rir];
    case 'distance':
      return loaded
        ? [{ key: 'distanceMeters', label: 'Metres', placeholder: 'm' }, weight, effortField]
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
  effort = 'rpe',
  showLabels,
  label,
  labelFull,
  muted = false,
  hint = null,
  onChange,
  onToggle,
}: {
  set: SetResult;
  entryStyle: EntryStyle;
  weightLabel: string;
  loadType: LoadType;
  effort?: EffortField;
  showLabels: boolean;
  /**
   * Overrides the left gutter. `setNumber` is unique across the whole sets array
   * — ramp sets take 1..n and working sets continue after them — so the ordinal
   * the user reads is always the caller's position within its own group.
   */
  label?: string;
  /** Spelled-out form of `label` for screen readers, when the gutter is abbreviated. */
  labelFull?: string;
  muted?: boolean;
  /** The same set from last time; its weight and reps become this row's placeholders. */
  hint?: SetResult | null;
  onChange: (next: SetResult) => void;
  onToggle: () => void;
}) {
  const fields = fieldsFor(entryStyle, weightLabel, loadType, effort);
  const gutter = label ?? `${set.setNumber}`;
  const spoken = labelFull ?? gutter;
  // The column count is data-driven so a fourth input (per-side + load + effort)
  // reflows instead of overflowing a 360px phone.
  const columns = { '--set-cols': fields.length } as CSSProperties;

  return (
    <>
      {showLabels && (
        <div className="set-row" style={columns} aria-hidden>
          <span />
          {fields.map((f) => (
            <span key={f.key} className="muted tiny" style={{ textAlign: 'center' }}>
              {f.label}
            </span>
          ))}
          <span />
        </div>
      )}
      <div className={`set-row ${muted ? 'ramp' : ''}`} style={columns}>
        <span className="set-no">{gutter}</span>
        {fields.map((f) => {
          const previous = HINTED.has(f.key) ? (hint?.[f.key] as number | null | undefined) : null;
          const hinted = previous != null;
          return (
            <input
              key={f.key}
              type="number"
              inputMode="decimal"
              step={f.step ?? 1}
              min={0}
              className={hinted ? 'hinted' : undefined}
              aria-label={`Set ${spoken} ${f.label}${hinted ? `, last time ${previous}` : ''}`}
              placeholder={hinted ? String(previous) : f.placeholder}
              value={(set[f.key] as number | null) ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                const value = raw === '' ? null : Number(raw);
                onChange(
                  applyField(set, f.key, value === null || Number.isNaN(value) ? null : value),
                );
              }}
            />
          );
        })}
        <button
          type="button"
          className={`check-btn ${set.completed ? 'on' : ''}`}
          aria-label={`Mark set ${spoken} ${set.completed ? 'incomplete' : 'complete'}`}
          aria-pressed={set.completed}
          onClick={onToggle}
        >
          <Check size={18} />
        </button>
      </div>
    </>
  );
}
