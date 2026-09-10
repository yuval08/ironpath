import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Pencil, PlayCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '@/state/AppDataProvider';
import { EXERCISES, exerciseName, getExercise } from '@/data/exercises';
import { programFor, WEEKDAY_LABELS } from '@/data/programs';
import {
  applyResumeChoice,
  createSession,
  plannedRepsLabel,
  projectedDate,
  updatePlan,
} from '@/db/repository';
import { Sheet } from '@/components/Sheet';
import { PauseManager } from '@/components/PauseManager';
import { BAND_LADDER, bandName, type BandLabels } from '@/utils/doubleProgression';
import { useToast } from '@/state/ToastProvider';
import { PlanSwitcher } from './PlanSwitcher';
import { PhaseBadge } from './PhaseBadge';
import type { BandResistance, ExercisePrescription, ResumeChoice, WorkoutDay } from '@/types';

export default function PlanScreen() {
  const { plan, settings, sessions } = useAppData();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [openWeek, setOpenWeek] = useState<number>(plan?.currentWeek ?? 1);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ day: WorkoutDay; p: ExercisePrescription } | null>(null);

  if (!plan || !settings) return null;

  const program = programFor(plan.programId);

  const applyChoice = async (choice: ResumeChoice) => {
    const labels: Record<ResumeChoice, string> = {
      resume: 'Continue from where you stopped?',
      restartWeek: 'Restart the current week? Sessions logged this week will be deleted.',
      restartBlock: `Restart ${program.name} from Week 1? Every session logged against this plan will be deleted.`,
    };
    if (choice !== 'resume' && !window.confirm(labels[choice])) return;
    await applyResumeChoice(choice);
    toast(
      choice === 'resume'
        ? 'Continuing where you left off'
        : choice === 'restartWeek'
          ? 'Current week restarted'
          : 'Plan restarted from Week 1',
    );
  };

  const startDay = async (day: WorkoutDay) => {
    const session = await createSession(plan, day, settings.weightOverrides);
    navigate(`/workout/${session.id}`);
  };

  const savePrescription = async (day: WorkoutDay, next: ExercisePrescription) => {
    await updatePlan({
      weeks: plan.weeks.map((w) =>
        w.weekNumber !== day.weekNumber
          ? w
          : {
              ...w,
              days: w.days.map((d) =>
                d.id !== day.id
                  ? d
                  : {
                      ...d,
                      prescriptions: d.prescriptions.map((p) => (p.id === next.id ? next : p)),
                    },
              ),
            },
      ),
    });
    setEditing(null);
    toast('Exercise updated');
  };

  const move = async (day: WorkoutDay, index: number, delta: number) => {
    const list = [...day.prescriptions];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    if (!a || !b) return;
    list[index] = b;
    list[target] = a;
    const reordered = list.map((p, i) => ({ ...p, order: i + 1 }));
    await updatePlan({
      weeks: plan.weeks.map((w) =>
        w.weekNumber !== day.weekNumber
          ? w
          : {
              ...w,
              days: w.days.map((d) => (d.id === day.id ? { ...d, prescriptions: reordered } : d)),
            },
      ),
    });
  };

  return (
    <div>
      <PlanSwitcher />

      <div className="card">
        <div className="card-title">
          <div style={{ minWidth: 0 }}>
            <h3>{program.name}</h3>
            <span className="muted tiny">
              {plan.weeks.length} weeks · {program.daysPerWeek} days a week · started{' '}
              {plan.startDate}
            </span>
          </div>
        </div>
        <p className="muted tiny" style={{ marginTop: 0 }}>
          {program.description}
        </p>
        <div className="stack">
          <button className="btn block" onClick={() => void applyChoice('resume')}>
            Resume where you stopped
          </button>
          <button className="btn block" onClick={() => void applyChoice('restartWeek')}>
            Restart the current week
          </button>
          <button className="btn block" onClick={() => void applyChoice('restartBlock')}>
            Restart this plan from Week 1
          </button>
        </div>
        <p className="muted tiny" style={{ margin: '10px 0 0' }}>
          Workouts are never locked to calendar dates — the dates shown are projections only.
        </p>
      </div>

      <PauseManager />

      {plan.weeks.map((week) => {
        const open = openWeek === week.weekNumber;
        return (
          <div className="card flush" key={week.weekNumber}>
            <button
              className="exercise-head"
              onClick={() => setOpenWeek(open ? -1 : week.weekNumber)}
              aria-expanded={open}
            >
              {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name">{week.title}</div>
                <div className="muted tiny">{week.focus}</div>
                <div className="week-head-meta">
                  <PhaseBadge week={week} />
                </div>
              </div>
              {plan.currentWeek === week.weekNumber && <span className="pill accent">Current</span>}
            </button>

            {open && (
              <div style={{ padding: '0 13px 13px' }}>
                <ul className="muted tiny" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                  {week.guidance.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
                {/* Only the resilience block sets a weekly push-up goal. */}
                {week.pushUpGoalLow != null && (
                  <div className="pill">
                    Push-up goal: {week.pushUpGoalLow}-{week.pushUpGoalHigh} reps this week
                  </div>
                )}

                {week.days.map((day, dayIndex) => {
                  const dayOpen = openDay === day.id;
                  // Scoped by planId: day ids are minted per program and two plans
                  // built from the same program share them exactly.
                  const session = sessions.find(
                    (s) => s.dayId === day.id && s.planId === plan.id && s.status === 'completed',
                  );
                  return (
                    <div key={day.id} style={{ marginTop: 10 }}>
                      <button
                        className="exercise-head"
                        style={{ padding: '10px 0' }}
                        onClick={() => setOpenDay(dayOpen ? null : day.id)}
                        aria-expanded={dayOpen}
                      >
                        {dayOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <div style={{ flex: 1 }}>
                          <div className="name">
                            {WEEKDAY_LABELS[day.weekday]} — {day.title}
                          </div>
                          <div className="muted tiny">
                            {projectedDate(plan, week.weekNumber, dayIndex)} · ~
                            {day.estimatedMinutes} min
                          </div>
                        </div>
                        {session && <span className="pill green">Done</span>}
                      </button>

                      {dayOpen && (
                        <div>
                          {day.prescriptions.map((p, i) => (
                            <div
                              key={p.id}
                              className="row tight"
                              style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                                  {p.slot && <span className="superset-slot">{p.slot}</span>}
                                  {exerciseName(p.exerciseId)}
                                  {p.optional && <span className="muted tiny"> · optional</span>}
                                </div>
                                <div className="muted tiny">
                                  {p.blockLabel} · {p.sets} × {plannedRepsLabel(p)}
                                  {p.rampSets > 0 ? ` · ${p.rampSets} ramp` : ''}
                                  {p.restSeconds ? ` · rest ${p.restSeconds}s` : ' · no rest'}
                                  {p.targetRirLow != null &&
                                    ` · RIR ${p.targetRirLow}${
                                      p.targetRirHigh != null && p.targetRirHigh !== p.targetRirLow
                                        ? `–${p.targetRirHigh}`
                                        : ''
                                    }`}
                                </div>
                              </div>
                              <button
                                className="btn ghost small icon"
                                aria-label={`Move ${exerciseName(p.exerciseId)} up`}
                                onClick={() => void move(day, i, -1)}
                              >
                                <ArrowUp size={14} />
                              </button>
                              <button
                                className="btn ghost small icon"
                                aria-label={`Move ${exerciseName(p.exerciseId)} down`}
                                onClick={() => void move(day, i, 1)}
                              >
                                <ArrowDown size={14} />
                              </button>
                              <button
                                className="btn ghost small icon"
                                aria-label={`Edit ${exerciseName(p.exerciseId)}`}
                                onClick={() => setEditing({ day, p })}
                              >
                                <Pencil size={14} />
                              </button>
                            </div>
                          ))}
                          <button
                            className="btn primary block small"
                            style={{ marginTop: 10 }}
                            onClick={() => void startDay(day)}
                          >
                            <PlayCircle size={16} /> Start this workout
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <Sheet open={!!editing} title="Edit exercise" onClose={() => setEditing(null)}>
        {editing && (
          <PrescriptionEditor
            prescription={editing.p}
            bandLabels={settings.bandLabels}
            onCancel={() => setEditing(null)}
            onSave={(next) => void savePrescription(editing.day, next)}
          />
        )}
      </Sheet>
    </div>
  );
}

function PrescriptionEditor({
  prescription,
  bandLabels,
  onSave,
  onCancel,
}: {
  prescription: ExercisePrescription;
  bandLabels: BandLabels;
  onSave: (next: ExercisePrescription) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ExercisePrescription>(prescription);
  const def = getExercise(draft.exerciseId);

  const num = (value: string): number | undefined => {
    const parsed = Number(value);
    return value === '' || Number.isNaN(parsed) ? undefined : parsed;
  };

  return (
    <div className="stack">
      <label className="field">
        Exercise
        <select
          value={draft.exerciseId}
          onChange={(e) => setDraft({ ...draft, exerciseId: e.target.value })}
        >
          {EXERCISES.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid-2">
        <label className="field">
          Sets
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={draft.sets}
            onChange={(e) => setDraft({ ...draft, sets: num(e.target.value) ?? 1 })}
          />
        </label>
        <label className="field">
          Rest (seconds)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.restSeconds}
            onChange={(e) => setDraft({ ...draft, restSeconds: num(e.target.value) ?? 0 })}
          />
        </label>
        <label className="field">
          Reps low
          <input
            type="number"
            inputMode="numeric"
            value={draft.repsLow ?? ''}
            onChange={(e) => setDraft({ ...draft, repsLow: num(e.target.value) })}
          />
        </label>
        <label className="field">
          Reps high
          <input
            type="number"
            inputMode="numeric"
            value={draft.repsHigh ?? ''}
            onChange={(e) => setDraft({ ...draft, repsHigh: num(e.target.value) })}
          />
        </label>
        <label className="field">
          Ramp sets
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.rampSets}
            onChange={(e) => setDraft({ ...draft, rampSets: num(e.target.value) ?? 0 })}
          />
        </label>
        <label className="field">
          Recommended weight
          <input
            type="number"
            inputMode="decimal"
            value={draft.recommendedWeight ?? ''}
            onChange={(e) => setDraft({ ...draft, recommendedWeight: num(e.target.value) ?? null })}
          />
        </label>
        <label className="field">
          Target RIR low
          <input
            type="number"
            inputMode="numeric"
            value={draft.targetRirLow ?? ''}
            onChange={(e) => setDraft({ ...draft, targetRirLow: num(e.target.value) ?? null })}
          />
        </label>
        <label className="field">
          Target RIR high
          <input
            type="number"
            inputMode="numeric"
            value={draft.targetRirHigh ?? ''}
            onChange={(e) => setDraft({ ...draft, targetRirHigh: num(e.target.value) ?? null })}
          />
        </label>
        <label className="field">
          Hold low (s)
          <input
            type="number"
            inputMode="numeric"
            value={draft.durationSecondsLow ?? ''}
            onChange={(e) => setDraft({ ...draft, durationSecondsLow: num(e.target.value) })}
          />
        </label>
        <label className="field">
          Hold high (s)
          <input
            type="number"
            inputMode="numeric"
            value={draft.durationSecondsHigh ?? ''}
            onChange={(e) => setDraft({ ...draft, durationSecondsHigh: num(e.target.value) })}
          />
        </label>
        <label className="field">
          Treadmill minutes
          <input
            type="number"
            inputMode="decimal"
            value={draft.minutes ?? ''}
            onChange={(e) => setDraft({ ...draft, minutes: num(e.target.value) })}
          />
        </label>
        <label className="field">
          Load step (kg)
          <input
            type="number"
            inputMode="decimal"
            step={0.5}
            value={draft.weightIncrement ?? ''}
            onChange={(e) => setDraft({ ...draft, weightIncrement: num(e.target.value) ?? null })}
          />
        </label>
      </div>

      <label className="field">
        Band resistance
        <select
          value={draft.recommendedBand ?? 'none'}
          onChange={(e) =>
            setDraft({ ...draft, recommendedBand: e.target.value as BandResistance })
          }
        >
          {BAND_LADDER.map((b) => (
            <option key={b} value={b}>
              {bandName(b, bandLabels)}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Substitution
        <select
          value={draft.substitutionIds[0] ?? 'none'}
          onChange={(e) =>
            setDraft({
              ...draft,
              substitutionIds: e.target.value === 'none' ? [] : [e.target.value],
            })
          }
        >
          <option value="none">No substitution</option>
          {EXERCISES.filter((ex) => ex.id !== draft.exerciseId).map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Video URL override
        <input
          type="url"
          placeholder={def ? `Default: search for ${def.name}` : 'https://…'}
          value={draft.videoUrlOverride ?? ''}
          onChange={(e) => setDraft({ ...draft, videoUrlOverride: e.target.value || undefined })}
        />
      </label>

      <label className="field">
        Notes
        <textarea
          value={draft.notes ?? ''}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </label>

      <div className="row">
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => onSave(draft)}>
          Save changes
        </button>
      </div>
    </div>
  );
}
