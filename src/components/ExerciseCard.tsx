import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Replace,
  SkipForward,
  Timer,
} from 'lucide-react';
import { exerciseName, getExercise } from '@/data/exercises';
import { substitutionsFor } from '@/data/substitutions';
import { painLevel } from '@/utils/stats';
import { SetRow } from './SetRow';
import { VideoLink } from './VideoLink';
import { PainScale } from './PainScale';
import type { ExercisePrescription, ExerciseResult, SetResult } from '@/types';

interface Props {
  prescription: ExercisePrescription;
  result: ExerciseResult;
  weightUnit: string;
  isCurrent: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (next: ExerciseResult) => void;
  onRest: (seconds: number) => void;
}

export function ExerciseCard({
  prescription,
  result,
  weightUnit,
  isCurrent,
  expanded,
  onToggleExpand,
  onChange,
  onRest,
}: Props) {
  const [showInstructions, setShowInstructions] = useState(false);
  const activeId = result.substitutionExerciseId ?? result.exerciseId;
  const def = getExercise(activeId);
  const subs = [
    ...new Set([...substitutionsFor(result.exerciseId), ...prescription.substitutionIds]),
  ];
  const painFlag = painLevel(result.painDuring) === 'red';

  const updateSet = (index: number, next: SetResult) => {
    const sets = result.sets.map((s, i) => (i === index ? next : s));
    onChange({ ...result, sets });
  };

  const toggleSet = (index: number) => {
    const current = result.sets[index];
    if (!current) return;
    const completed = !current.completed;
    const sets = result.sets.map((s, i) => (i === index ? { ...s, completed } : s));
    const allDone = sets.every((s) => s.completed);
    onChange({ ...result, sets, completed: allDone });
    if (completed && prescription.restSeconds > 0) onRest(prescription.restSeconds);
  };

  const markComplete = () => {
    const sets = result.sets.map((s) => ({ ...s, completed: true }));
    onChange({ ...result, sets, completed: true });
  };

  const doneCount = result.sets.filter((s) => s.completed).length;

  return (
    <div
      className={`exercise-card ${isCurrent ? 'current' : ''} ${result.completed ? 'done' : ''}`}
      id={`ex-${prescription.id}`}
    >
      <button className="exercise-head" onClick={onToggleExpand} aria-expanded={expanded}>
        {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">
            {exerciseName(activeId)}
            {result.substitutionExerciseId && <span className="muted tiny"> (substituted)</span>}
          </div>
          <div className="muted tiny">
            {result.plannedSets} × {result.plannedReps}
            {def?.isNewMovement ? ' · new movement' : ''}
          </div>
        </div>
        {result.skippedReason ? (
          <span className="pill">Skipped</span>
        ) : result.completed ? (
          <span className="pill green">
            <Check size={12} /> Done
          </span>
        ) : (
          <span className="pill">
            {doneCount}/{result.sets.length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="exercise-body">
          {prescription.notes && <p className="muted tiny">{prescription.notes}</p>}
          {prescription.tempo && (
            <p className="muted tiny">
              <strong>Tempo:</strong> {prescription.tempo}
            </p>
          )}

          {result.sets.map((set, i) => (
            <SetRow
              key={set.setNumber}
              set={set}
              entryStyle={prescription.entryStyle}
              weightLabel={weightUnit}
              showLabels={i === 0}
              onChange={(next) => updateSet(i, next)}
              onToggle={() => toggleSet(i)}
            />
          ))}

          <div className="row tight" style={{ marginTop: 8 }}>
            {prescription.restSeconds > 0 && (
              <button className="btn small" onClick={() => onRest(prescription.restSeconds)}>
                <Timer size={14} /> Rest {prescription.restSeconds}s
              </button>
            )}
            <button className="btn small" onClick={markComplete} disabled={result.completed}>
              <Check size={14} /> Complete all
            </button>
            <button
              className="btn small ghost"
              onClick={() => setShowInstructions((s) => !s)}
              aria-expanded={showInstructions}
            >
              <Info size={14} /> How to
            </button>
          </div>

          <div style={{ marginTop: 8 }}>
            <VideoLink
              exerciseId={activeId}
              compact
              onViewed={() => onChange({ ...result, videoViewed: true })}
            />
          </div>

          {showInstructions && def && (
            <div className="card" style={{ marginTop: 10, boxShadow: 'none' }}>
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
                value={result.substitutionExerciseId ?? ''}
                onChange={(e) =>
                  onChange({ ...result, substitutionExerciseId: e.target.value || null })
                }
              >
                <option value="">None — as programmed</option>
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
        </div>
      )}
    </div>
  );
}
