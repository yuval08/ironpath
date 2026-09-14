import { AlertTriangle, Replace, SkipForward } from 'lucide-react';
import { exerciseName, getExercise } from '@/data/exercises';
import { substitutionsFor } from '@/data/substitutions';
import { painLevel } from '@/utils/stats';
import { Sheet } from './Sheet';
import { VideoLink } from './VideoLink';
import { PainScale } from './PainScale';
import { ExerciseHistory } from './ExerciseHistory';
import type { BandLabels, PerformanceSnapshot } from '@/utils/doubleProgression';
import type { ExercisePrescription, ExerciseResult } from '@/types';

/** Sentinel option value: an empty <option value> writes undefined back into the result. */
const AS_PROGRAMMED = 'as-programmed';

/**
 * Everything about an exercise that is *not* logging a set: recent history,
 * technique, pain, form, substitution, notes and skipping.
 *
 * These used to sit inline under every card, which pushed the set inputs — the only
 * thing touched mid-set — off the screen. They are one tap away instead, and the
 * card advertises when any of them carry a value so nothing recorded here is
 * invisible from the outside.
 */
export function ExerciseOptionsSheet({
  open,
  onClose,
  prescription,
  result,
  history = [],
  weightUnit = 'lb',
  bandLabels,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  prescription: ExercisePrescription;
  result: ExerciseResult;
  /** Recent performances, newest first. */
  history?: PerformanceSnapshot[];
  weightUnit?: string;
  bandLabels?: BandLabels;
  onChange: (next: ExerciseResult) => void;
}) {
  const activeId = result.substitutionExerciseId ?? result.exerciseId;
  const def = getExercise(activeId);
  const subs = [
    ...new Set([...substitutionsFor(result.exerciseId), ...prescription.substitutionIds]),
  ];
  const painFlag = painLevel(result.painDuring) === 'red';

  return (
    <Sheet open={open} title={exerciseName(activeId)} onClose={onClose}>
      {/* First, because it is what gets checked mid-session: what did I do last time? */}
      <ExerciseHistory history={history} weightUnit={weightUnit} bandLabels={bandLabels} />

      <div className="divider" />

      <VideoLink
        exerciseId={activeId}
        compact
        onViewed={() => onChange({ ...result, videoViewed: true })}
      />

      {def && (
        <div style={{ marginTop: 10 }}>
          <ol style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: '0.85rem' }}>
            {def.instructions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {def.commonMistakes.length > 0 && (
            <p className="muted tiny" style={{ margin: 0 }}>
              <strong>Avoid:</strong> {def.commonMistakes.join(' · ')}
            </p>
          )}
          {def.safetyNotes.length > 0 && (
            <p className="muted tiny" style={{ margin: '4px 0 0' }}>
              <strong>Safety:</strong> {def.safetyNotes.join(' ')}
            </p>
          )}
        </div>
      )}

      <div className="divider" />

      <PainScale
        label="Pain during this exercise"
        value={result.painDuring}
        onChange={(v) => onChange({ ...result, painDuring: v })}
      />

      {painFlag && (
        <div className="banner danger">
          <div className="row tight">
            <AlertTriangle size={15} />
            <strong>Pain at {result.painDuring}/10</strong>
          </div>
          Stop this exercise and switch to the programmed substitution below. This app does not
          diagnose the cause.
        </div>
      )}

      <div className="row tight" style={{ marginBottom: 10 }}>
        <span className="muted tiny">Form:</span>
        <button
          className={`btn small ${result.formGood === true ? 'primary' : 'ghost'}`}
          onClick={() => onChange({ ...result, formGood: true })}
        >
          Clean
        </button>
        <button
          className={`btn small ${result.formGood === false ? 'primary' : 'ghost'}`}
          onClick={() => onChange({ ...result, formGood: false })}
        >
          Broke down
        </button>
      </div>

      {subs.length > 0 && (
        <label className="field" style={{ marginBottom: 10 }}>
          <span className="row tight">
            <Replace size={13} /> Substitution
          </span>
          <select
            value={result.substitutionExerciseId ?? AS_PROGRAMMED}
            onChange={(e) =>
              onChange({
                ...result,
                substitutionExerciseId: e.target.value === AS_PROGRAMMED ? null : e.target.value,
              })
            }
          >
            <option value={AS_PROGRAMMED}>None — as programmed</option>
            {subs.map((id) => (
              <option key={id} value={id}>
                {exerciseName(id)}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field" style={{ marginBottom: 10 }}>
        Notes
        <textarea
          value={result.notes}
          placeholder="Cues, how it felt, anything to remember"
          onChange={(e) => onChange({ ...result, notes: e.target.value })}
        />
      </label>

      <button
        className="btn small ghost block"
        onClick={() => {
          if (result.skippedReason) {
            onChange({ ...result, skippedReason: null });
            return;
          }
          const reason = window.prompt('Why are you skipping this exercise?', 'Pain');
          if (reason != null) onChange({ ...result, skippedReason: reason || 'Skipped' });
        }}
      >
        <SkipForward size={14} /> {result.skippedReason ? 'Un-skip exercise' : 'Skip exercise'}
      </button>

      <button className="btn primary block" style={{ marginTop: 10 }} onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}

/** True when the sheet holds anything the user would want to see from the card. */
export function hasExerciseOptions(result: ExerciseResult): boolean {
  return (
    result.painDuring != null ||
    result.formGood != null ||
    result.notes.trim() !== '' ||
    result.substitutionExerciseId != null ||
    result.skippedReason != null
  );
}
