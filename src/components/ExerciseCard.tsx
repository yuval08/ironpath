import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
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
import type { EffortField } from './SetRow';
import { VideoLink } from './VideoLink';
import { PainScale } from './PainScale';
import { HistoryLine } from './HistoryLine';
import { ProgressionBanner } from './ProgressionBanner';
import { BandPicker } from './BandPicker';
import type {
  BandLabels,
  PerformanceSnapshot,
  ProgressionVerdict,
} from '@/utils/doubleProgression';
import type { BandResistance, ExercisePrescription, ExerciseResult, SetResult } from '@/types';

interface Props {
  prescription: ExercisePrescription;
  result: ExerciseResult;
  weightUnit: string;
  isCurrent: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (next: ExerciseResult) => void;
  onRest: (seconds: number) => void;
  /** Last logged performance of this exercise, for the history line. */
  lastSnapshot?: PerformanceSnapshot | null;
  /** Verdict from the previous session; only 'ready' renders a banner. */
  verdict?: ProgressionVerdict | null;
  bandLabels?: BandLabels;
  /**
   * Rounds this exercise is performed paired with the rest of its superset —
   * `min(sets)` across the group. Sets past it are straight sets.
   */
  pairedRounds?: number | null;
  /** Rest to take on the straight sets that outlast the pairing. */
  straightRestSeconds?: number | null;
  /** Shown after a set when another superset slot comes next instead of rest. */
  nextHint?: string | null;
  onSetToggled?: (completed: boolean) => void;
}

/** Sentinel option value: an empty <option value> writes undefined back into the result. */
const AS_PROGRAMMED = 'as-programmed';

/** Hypertrophy work is prescribed in RIR; the resilience block still logs RPE. */
function effortFor(prescription: ExercisePrescription): EffortField {
  const { progressionType, targetRirLow, targetRirHigh } = prescription;
  if (progressionType === 'double' || progressionType === 'bandAssist') return 'rir';
  return targetRirLow != null || targetRirHigh != null ? 'rir' : 'rpe';
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
  lastSnapshot = null,
  verdict = null,
  bandLabels,
  pairedRounds = null,
  straightRestSeconds = null,
  nextHint = null,
  onSetToggled,
}: Props) {
  const [showInstructions, setShowInstructions] = useState(false);
  const activeId = result.substitutionExerciseId ?? result.exerciseId;
  const def = getExercise(activeId);
  const subs = [
    ...new Set([...substitutionsFor(result.exerciseId), ...prescription.substitutionIds]),
  ];
  const painFlag = painLevel(result.painDuring) === 'red';
  const effort = effortFor(prescription);

  // Ramp sets are logged for context only: they never count toward the x/y
  // counter, completion, or anything sessionProgress can see.
  const ramp = result.sets.filter((s) => s.isWarmUp);
  const working = result.sets.filter((s) => !s.isWarmUp);
  const doneCount = working.filter((s) => s.completed).length;
  const straightFrom = pairedRounds != null && working.length > pairedRounds ? pairedRounds : null;

  const withSets = (sets: SetResult[]): ExerciseResult => {
    const workingSets = sets.filter((s) => !s.isWarmUp);
    return {
      ...result,
      sets,
      completed: workingSets.length > 0 && workingSets.every((s) => s.completed),
    };
  };

  const updateSet = (index: number, next: SetResult) => {
    onChange(withSets(result.sets.map((s, i) => (i === index ? next : s))));
  };

  const toggleSet = (index: number) => {
    const current = result.sets[index];
    if (!current) return;
    const completed = !current.completed;
    onChange(withSets(result.sets.map((s, i) => (i === index ? { ...s, completed } : s))));
    // A ramp set is a plate change, not a working effort — no rest, and no cue
    // to move on to the next superset slot.
    if (current.isWarmUp) return;
    onSetToggled?.(completed);
    if (!completed) return;
    // `restSeconds === 0` is the program's way of saying "go straight to the next
    // slot"; the superset hint takes the place of the timer there.
    const workingIndex = working.findIndex((s) => s.setNumber === current.setNumber);
    const seconds =
      straightFrom != null && workingIndex >= straightFrom && straightRestSeconds != null
        ? straightRestSeconds
        : prescription.restSeconds;
    if (seconds > 0) onRest(seconds);
  };

  const markComplete = () => {
    // Only the working sets — a skipped ramp set must not read as "done".
    onChange(withSets(result.sets.map((s) => (s.isWarmUp ? s : { ...s, completed: true }))));
  };

  /** Prefills THIS session's open sets. Never touches the session it was derived from. */
  const applyProgression = () => {
    if (!verdict) return;
    const sets = result.sets.map((s) => {
      if (s.isWarmUp || s.completed) return s;
      if (verdict.suggestedWeight != null) return { ...s, weight: verdict.suggestedWeight };
      if (verdict.suggestedBand != null) return { ...s, band: verdict.suggestedBand };
      return s;
    });
    onChange({ ...result, sets });
  };

  const currentBand =
    working.find((s) => !s.completed)?.band ??
    working[working.length - 1]?.band ??
    prescription.recommendedBand ??
    null;

  const setBand = (band: BandResistance) => {
    // Completed sets keep the band they were actually performed with.
    onChange({
      ...result,
      sets: result.sets.map((s) => (s.completed ? s : { ...s, band })),
    });
  };

  return (
    <div
      className={`exercise-card ${isCurrent ? 'current' : ''} ${result.completed ? 'done' : ''}`}
      id={`ex-${prescription.id}`}
    >
      <button className="exercise-head" onClick={onToggleExpand} aria-expanded={expanded}>
        {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">
            {prescription.slot && <span className="slot-badge">{prescription.slot}</span>}
            {exerciseName(activeId)}
            {result.substitutionExerciseId && <span className="muted tiny"> (substituted)</span>}
          </div>
          <div className="muted tiny">
            {result.plannedSets} × {result.plannedReps}
            {ramp.length > 0 ? ` · +${ramp.length} ramp` : ''}
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
            {doneCount}/{working.length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="exercise-body">
          <HistoryLine
            prescription={prescription}
            last={lastSnapshot}
            weightUnit={weightUnit}
            bandLabels={bandLabels}
          />

          {verdict && (
            <ProgressionBanner
              verdict={verdict}
              weightUnit={weightUnit}
              bandLabels={bandLabels}
              onApply={applyProgression}
            />
          )}

          {prescription.notes && <p className="muted tiny">{prescription.notes}</p>}
          {prescription.tempo && (
            <p className="muted tiny">
              <strong>Tempo:</strong> {prescription.tempo}
            </p>
          )}

          {prescription.progressionType === 'bandAssist' && (
            <BandPicker value={currentBand} bandLabels={bandLabels} onChange={setBand} />
          )}

          {ramp.length > 0 && (
            <div className="ramp-block">
              <div className="ramp-label muted tiny">Ramp — not counted</div>
              {ramp.map((set, i) => (
                <SetRow
                  key={`ramp-${set.setNumber}`}
                  set={set}
                  entryStyle={prescription.entryStyle}
                  weightLabel={weightUnit}
                  loadType={def?.loadType ?? 'bodyweight'}
                  effort={effort}
                  showLabels={i === 0}
                  label={`R${i + 1}`}
                  labelFull={`Ramp ${i + 1}`}
                  muted
                  onChange={(next) => updateSet(result.sets.indexOf(set), next)}
                  onToggle={() => toggleSet(result.sets.indexOf(set))}
                />
              ))}
            </div>
          )}

          {working.map((set, i) => (
            <div key={set.setNumber}>
              {straightFrom != null && i === straightFrom && (
                <div className="straight-divider">
                  Remaining {working.length - straightFrom} sets — straight sets
                </div>
              )}
              <SetRow
                set={set}
                entryStyle={prescription.entryStyle}
                weightLabel={weightUnit}
                loadType={def?.loadType ?? 'bodyweight'}
                effort={effort}
                showLabels={i === 0 && ramp.length === 0}
                label={`${i + 1}`}
                labelFull={`${i + 1} of ${working.length}`}
                onChange={(next) => updateSet(result.sets.indexOf(set), next)}
                onToggle={() => toggleSet(result.sets.indexOf(set))}
              />
            </div>
          ))}

          {nextHint && (
            <div className="next-hint">
              <ArrowRight size={14} /> Next: {nextHint}
            </div>
          )}

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
                value={result.substitutionExerciseId ?? AS_PROGRAMMED}
                onChange={(e) =>
                  onChange({
                    ...result,
                    substitutionExerciseId:
                      e.target.value === AS_PROGRAMMED ? null : e.target.value,
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
        </div>
      )}
    </div>
  );
}
