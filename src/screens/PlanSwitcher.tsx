import { useRef, useState } from 'react';
import { Archive, ArchiveRestore, Check, Plus, Trash2, Upload } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { useToast } from '@/state/ToastProvider';
import { Sheet } from '@/components/Sheet';
import { DEFAULT_PROGRAM_ID, PROGRAMS, programFor } from '@/data/programs';
import {
  archivePlan,
  createPlanFromProgram,
  defaultStartDate,
  deletePlan,
  setActivePlan,
  totalSessionsFor,
} from '@/db/repository';
import { importPlan, MAX_PLAN_FILE_BYTES } from '@/utils/planImport';
import { readJsonFile } from '@/utils/backup';
import { completedSessions } from '@/utils/stats';
import type { ProgramId, WorkoutPlan } from '@/types';

/** Typing this exactly is what unlocks the delete button. */
const DELETE_PHRASE = 'DELETE';

const PROGRAM_IDS = Object.keys(PROGRAMS) as Exclude<ProgramId, 'custom'>[];

/**
 * The one place a plan is switched, created, archived or deleted. It reads the
 * whole plan list from AppDataProvider rather than taking props so the Plan and
 * Settings screens can both render it without either owning the state.
 */
export function PlanSwitcher() {
  const { plan: activePlan, plans, sessions } = useAppData();
  const { toast } = useToast();
  const planInput = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const importFile = async (file: File) => {
    if (importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    try {
      if (file.size > MAX_PLAN_FILE_BYTES) throw new Error('Plan files must be 1 MiB or smaller.');
      const plan = await importPlan(await readJsonFile(file));
      toast(`Imported ${plan.name} and made it active`);
    } catch (error) {
      toast(`Import failed: ${(error as Error).message}`);
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<WorkoutPlan | null>(null);

  const switchTo = async (target: WorkoutPlan) => {
    if (target.id === activePlan?.id) return;
    await setActivePlan(target.id);
    toast(`Now training ${target.name}`);
  };

  const toggleArchive = async (target: WorkoutPlan) => {
    await archivePlan(target.id, !target.archived);
    toast(target.archived ? 'Plan restored' : 'Plan archived');
  };

  return (
    <>
      <div className="card flush">
        <div className="card-title" style={{ padding: '13px 13px 4px' }}>
          <h3>Your plans</h3>
          <span className="pill">{plans.length}</span>
        </div>

        {plans.map((p) => {
          const isActive = p.id === activePlan?.id;
          const total = totalSessionsFor(p);
          const done = completedSessions(sessions.filter((s) => s.planId === p.id)).length;
          return (
            <div key={p.id}>
              <button
                className={`plan-row ${isActive ? 'active' : ''}`}
                onClick={() => void switchTo(p)}
                aria-pressed={isActive}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="plan-name">{programFor(p).name}</div>
                  <div className="muted tiny">
                    Week {p.currentWeek} of {p.weeks.length} · {done}/{total} sessions
                    {p.completedAt ? ' · finished' : ''}
                  </div>
                </div>
                {isActive && (
                  <span className="pill accent">
                    <Check size={12} aria-hidden /> Active
                  </span>
                )}
                {p.archived && <span className="pill">Archived</span>}
              </button>

              <div className="plan-actions">
                <button className="btn ghost small" onClick={() => void toggleArchive(p)}>
                  {p.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  {p.archived ? 'Restore' : 'Archive'}
                </button>
                <button className="btn ghost small" onClick={() => setDeleting(p)}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          );
        })}

        <div className="plan-actions">
          <button className="btn primary small block" onClick={() => setCreating(true)}>
            <Plus size={15} /> Start a new plan
          </button>
        </div>
        <div className="plan-actions">
          <button
            className="btn small block"
            disabled={importing}
            onClick={() => planInput.current?.click()}
          >
            <Upload size={15} /> {importing ? 'Importing…' : 'Import plan from JSON'}
          </button>
          <input
            ref={planInput}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Import plan JSON file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importFile(file);
            }}
          />
        </div>
      </div>

      <Sheet open={creating} title="Start a new plan" onClose={() => setCreating(false)}>
        <NewPlanForm
          onDone={(name) => {
            setCreating(false);
            toast(`Started ${name}`);
          }}
        />
      </Sheet>

      <Sheet open={!!deleting} title="Delete this plan" onClose={() => setDeleting(null)}>
        {deleting && (
          <DeletePlanForm
            plan={deleting}
            sessionCount={sessions.filter((s) => s.planId === deleting.id).length}
            onDone={() => {
              setDeleting(null);
              toast('Plan and its sessions deleted');
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function NewPlanForm({ onDone }: { onDone: (name: string) => void }) {
  const [programId, setProgramId] = useState<ProgramId>(DEFAULT_PROGRAM_ID);
  const [startDate, setStartDate] = useState(defaultStartDate());
  const [busy, setBusy] = useState(false);
  const program = programFor(programId);

  const create = async () => {
    setBusy(true);
    try {
      const plan = await createPlanFromProgram(programId, startDate);
      await setActivePlan(plan.id);
      onDone(program.name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <label className="field">
        Program
        <select value={programId} onChange={(e) => setProgramId(e.target.value as ProgramId)}>
          {PROGRAM_IDS.map((id) => (
            <option key={id} value={id}>
              {PROGRAMS[id].name}
            </option>
          ))}
        </select>
      </label>

      <p className="muted tiny" style={{ margin: 0 }}>
        {program.description}
      </p>
      <div className="kv">
        <span className="k">Length</span>
        <span className="v">
          {program.weekCount} weeks · {program.daysPerWeek} days/week
        </span>
      </div>

      <label className="field">
        Start date
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value || defaultStartDate())}
        />
      </label>

      <p className="muted tiny" style={{ margin: 0 }}>
        Your existing plans and everything logged against them stay exactly where they are. The new
        plan simply becomes the one you are training.
      </p>

      <button className="btn primary block" disabled={busy} onClick={() => void create()}>
        {busy ? 'Creating…' : 'Create and make active'}
      </button>
    </div>
  );
}

function DeletePlanForm({
  plan,
  sessionCount,
  onDone,
}: {
  plan: WorkoutPlan;
  sessionCount: number;
  onDone: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await deletePlan(plan.id);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="banner danger">
        <strong>{programFor(plan).name}</strong>
        <br />
        Deleting this plan also deletes the {sessionCount} session
        {sessionCount === 1 ? '' : 's'} logged against it, and its final assessment. This cannot be
        undone — export a backup first if you want to keep the history.
      </div>

      <label className="field">
        Type {DELETE_PHRASE} to confirm
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder={DELETE_PHRASE}
        />
      </label>

      <button
        className="btn danger block"
        disabled={busy || typed.trim().toUpperCase() !== DELETE_PHRASE}
        onClick={() => void remove()}
      >
        <Trash2 size={16} /> Delete plan and its {sessionCount} session
        {sessionCount === 1 ? '' : 's'}
      </button>
    </div>
  );
}
