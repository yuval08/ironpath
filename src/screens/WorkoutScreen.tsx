import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Pause, Play, Plus, X } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { useToast } from '@/state/ToastProvider';
import { useRestTimer, useStopwatch, REST_PRESETS } from '@/hooks/useTimers';
import { ExerciseCard } from '@/components/ExerciseCard';
import { WarmUp } from '@/components/WarmUp';
import { FollowAlongVideo } from '@/components/FollowAlongVideo';
import { EMPTY_PAIN, PainForm } from '@/components/PainScale';
import { Sheet } from '@/components/Sheet';
import {
  completeSession,
  createSession,
  currentDay,
  findInProgressSession,
  getSession,
  getSuggestions,
  recordPR,
  saveSession,
  saveSuggestions,
} from '@/db/repository';
import { detectProgressions } from '@/utils/progression';
import { formatDuration, sessionProgress, setReps } from '@/utils/stats';
import { db } from '@/db/db';
import type { ExerciseResult, PainEntry, WorkoutDay, WorkoutSession } from '@/types';

export default function WorkoutScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { plan, settings, sessions } = useAppData();
  const { toast } = useToast();

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [painBeforeOpen, setPainBeforeOpen] = useState(false);
  const [painAfterOpen, setPainAfterOpen] = useState(false);
  const [painDraft, setPainDraft] = useState<PainEntry>(EMPTY_PAIN);

  const stopwatch = useStopwatch(0, false);
  const rest = useRestTimer({
    vibrate: settings?.vibrateOnRestEnd ?? true,
    sound: settings?.soundOnRestEnd ?? false,
  });

  /* ---------------------------------------------------------- loading */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const found = sessionId ? await getSession(sessionId) : await findInProgressSession();
      if (cancelled) return;
      setSession(found ?? null);
      if (found) {
        stopwatch.reset(found.elapsedSeconds);
        if (found.warmUpCompletedAt && found.status === 'inProgress') stopwatch.start();
        const firstOpen = found.results.find((r) => !r.completed && !r.skippedReason);
        setExpanded(firstOpen?.prescriptionId ?? found.results[0]?.prescriptionId ?? null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /* ---------------------------------------------------- persist timer */
  useEffect(() => {
    if (!session || session.status !== 'inProgress') return;
    if (stopwatch.elapsed === session.elapsedSeconds) return;
    const id = window.setTimeout(() => {
      void db.sessions.update(session.id, { elapsedSeconds: stopwatch.elapsed });
    }, 4000);
    return () => window.clearTimeout(id);
  }, [stopwatch.elapsed, session]);

  const day: WorkoutDay | undefined = useMemo(() => {
    if (!plan || !session) return undefined;
    return plan.weeks
      .find((w) => w.weekNumber === session.weekNumber)
      ?.days.find((d) => d.id === session.dayId);
  }, [plan, session]);

  const persist = useCallback(async (next: WorkoutSession) => {
    setSession(next);
    await saveSession(next);
  }, []);

  const updateResult = (next: ExerciseResult) => {
    if (!session) return;
    const results = session.results.map((r) =>
      r.prescriptionId === next.prescriptionId ? next : r,
    );
    void persist({ ...session, results, elapsedSeconds: stopwatch.elapsed });
    if (next.completed && settings?.autoCollapseCompleted) {
      const nextOpen = results.find((r) => !r.completed && !r.skippedReason);
      setExpanded(nextOpen?.prescriptionId ?? null);
    }
  };

  const startFresh = async () => {
    if (!plan || !settings) return;
    const target = currentDay(plan);
    if (!target) return;
    const created = await createSession(plan, target, settings.weightOverrides);
    navigate(`/workout/${created.id}`, { replace: true });
  };

  const finish = async () => {
    if (!session) return;
    const finished: WorkoutSession = {
      ...session,
      painAfter: painDraft,
      elapsedSeconds: stopwatch.elapsed,
    };
    await completeSession(finished);
    await capturePRs(finished);
    const existing = await getSuggestions();
    const all = await db.sessions.toArray();
    const fresh = detectProgressions(
      [...all.filter((s) => s.id !== finished.id), finished].sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt),
      ),
      existing,
    );
    if (fresh.length) await saveSuggestions(fresh);
    setPainAfterOpen(false);
    toast(
      fresh.length
        ? `Workout saved · ${fresh.length} progression suggestion${fresh.length > 1 ? 's' : ''}`
        : 'Workout saved',
    );
    navigate('/progress');
  };

  if (loading) return <p className="muted">Loading workout…</p>;

  if (!session || !plan || !settings) {
    return (
      <div className="card">
        <h3>No workout in progress</h3>
        <p className="muted tiny">Start the next session in your plan.</p>
        <button className="btn primary block" onClick={() => void startFresh()}>
          <Play size={17} /> Start {currentDay(plan!)?.title ?? 'workout'}
        </button>
      </div>
    );
  }

  if (session.status === 'completed') {
    return (
      <div className="card">
        <h3>{day?.title ?? 'Workout'} — completed</h3>
        <p className="muted tiny">
          Finished in {formatDuration(session.elapsedSeconds)} on {session.date}.
        </p>
        <button className="btn block" onClick={() => navigate('/progress')}>
          View progress
        </button>
      </div>
    );
  }

  const warmUpDone = !!session.warmUpCompletedAt;
  const blocks = groupByBlock(session, day);
  const nextExercise = session.results.find((r) => !r.completed && !r.skippedReason);
  const otherInProgress = sessions.filter(
    (s) => s.status === 'inProgress' && s.id !== session.id,
  ).length;

  return (
    <div style={{ paddingBottom: 64 }}>
      <div className="card">
        <div className="card-title">
          <div>
            <h2>{day?.title ?? 'Workout'}</h2>
            <span className="muted tiny">
              Week {session.weekNumber} · {day?.focus} · target ~{day?.estimatedMinutes ?? 60} min
            </span>
          </div>
          <span className="pill accent">{sessionProgress(session)}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${sessionProgress(session)}%` }} />
        </div>
        {otherInProgress > 0 && (
          <p className="muted tiny" style={{ marginTop: 8 }}>
            You have {otherInProgress} other unfinished session{otherInProgress > 1 ? 's' : ''}.
          </p>
        )}
      </div>

      <WarmUp
        items={session.warmUp}
        finished={warmUpDone}
        onChange={(warmUp) => void persist({ ...session, warmUp })}
        onFinish={() => {
          void persist({ ...session, warmUpCompletedAt: new Date().toISOString() });
          stopwatch.reset(0);
          stopwatch.start();
          if (!session.painBefore) {
            setPainDraft(EMPTY_PAIN);
            setPainBeforeOpen(true);
          }
        }}
      />

      {!session.painBefore && warmUpDone && (
        <button
          className="btn block"
          style={{ marginBottom: 12 }}
          onClick={() => {
            setPainDraft(EMPTY_PAIN);
            setPainBeforeOpen(true);
          }}
        >
          Record pain before training
        </button>
      )}

      {warmUpDone && session.dayType === 'mobility' && <FollowAlongVideo />}

      {warmUpDone &&
        blocks.map((block) => (
          <div key={block.label}>
            <div className="block-head">{block.label}</div>
            <div className="superset-group">
              {block.items.map(({ prescription, result }) => (
                <ExerciseCard
                  key={prescription.id}
                  prescription={prescription}
                  result={result}
                  weightUnit={settings.weightUnit}
                  isCurrent={nextExercise?.prescriptionId === prescription.id}
                  expanded={expanded === prescription.id}
                  onToggleExpand={() =>
                    setExpanded(expanded === prescription.id ? null : prescription.id)
                  }
                  onChange={updateResult}
                  onRest={(seconds) => rest.start(seconds)}
                />
              ))}
            </div>
          </div>
        ))}

      {warmUpDone && (
        <div className="card" style={{ marginTop: 16 }}>
          <label className="field">
            Session notes
            <textarea
              value={session.sessionNotes}
              onChange={(e) => void persist({ ...session, sessionNotes: e.target.value })}
              placeholder="How did the session go?"
            />
          </label>
          <label className="field" style={{ marginTop: 10 }}>
            Bodyweight ({settings.weightUnit})
            <input
              type="number"
              inputMode="decimal"
              step={0.1}
              value={session.bodyweight ?? ''}
              onChange={(e) =>
                void persist({
                  ...session,
                  bodyweight: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </label>
        </div>
      )}

      {/* Sticky timer + next action */}
      <div className="sticky-bar">
        <button
          className="btn ghost small icon"
          aria-label={stopwatch.running ? 'Pause timer' : 'Start timer'}
          onClick={stopwatch.toggle}
        >
          {stopwatch.running ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <span className="timer-value">{formatDuration(stopwatch.elapsed)}</span>
        {nextExercise ? (
          <button
            className="btn primary small"
            style={{ flex: 1 }}
            onClick={() => {
              setExpanded(nextExercise.prescriptionId);
              document
                .getElementById(`ex-${nextExercise.prescriptionId}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          >
            <ChevronDown size={16} /> Next exercise
          </button>
        ) : (
          <button
            className="btn primary small"
            style={{ flex: 1 }}
            onClick={() => {
              setPainDraft(session.painBefore ?? EMPTY_PAIN);
              setPainAfterOpen(true);
            }}
          >
            Finish workout
          </button>
        )}
        {nextExercise && (
          <button
            className="btn small"
            onClick={() => {
              setPainDraft(session.painBefore ?? EMPTY_PAIN);
              setPainAfterOpen(true);
            }}
          >
            Finish
          </button>
        )}
      </div>

      {/* Rest timer overlay */}
      {rest.remaining != null && (
        <div className="rest-overlay">
          <span className="muted">Rest</span>
          <div className="count">{rest.remaining}</div>
          <div className="row tight">
            {REST_PRESETS.map((p) => (
              <button key={p} className="btn small" onClick={() => rest.start(p)}>
                {p}s
              </button>
            ))}
          </div>
          <div className="row tight">
            <button className="btn small" onClick={() => rest.add(15)}>
              <Plus size={14} /> 15s
            </button>
            <button className="btn primary small" onClick={rest.stop}>
              <X size={14} /> Skip rest
            </button>
          </div>
        </div>
      )}

      <Sheet
        open={painBeforeOpen}
        title="Pain before training"
        onClose={() => setPainBeforeOpen(false)}
      >
        <PainForm value={painDraft} onChange={setPainDraft} />
        <button
          className="btn primary block"
          onClick={() => {
            void persist({ ...session, painBefore: painDraft });
            setPainBeforeOpen(false);
          }}
        >
          Save
        </button>
      </Sheet>

      <Sheet
        open={painAfterOpen}
        title="Pain after training"
        onClose={() => setPainAfterOpen(false)}
      >
        <PainForm value={painDraft} onChange={setPainDraft} />
        <button className="btn primary block" onClick={() => void finish()}>
          Save &amp; complete workout
        </button>
      </Sheet>
    </div>
  );
}

interface Block {
  label: string;
  items: {
    prescription: NonNullable<WorkoutDay['prescriptions'][number]>;
    result: ExerciseResult;
  }[];
}

function groupByBlock(session: WorkoutSession, day: WorkoutDay | undefined): Block[] {
  if (!day) return [];
  const blocks: Block[] = [];
  for (const prescription of [...day.prescriptions].sort((a, b) => a.order - b.order)) {
    const result = session.results.find((r) => r.prescriptionId === prescription.id);
    if (!result) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.label === prescription.blockLabel) last.items.push({ prescription, result });
    else blocks.push({ label: prescription.blockLabel, items: [{ prescription, result }] });
  }
  return blocks;
}

/** Records any personal record the finished session beat. */
async function capturePRs(session: WorkoutSession): Promise<void> {
  const best = (
    exerciseId: string,
    pick: (s: (typeof session.results)[number]['sets'][number]) => number,
  ) =>
    session.results
      .filter((r) => (r.substitutionExerciseId ?? r.exerciseId) === exerciseId)
      .flatMap((r) => r.sets.filter((s) => s.completed))
      .reduce((max, s) => Math.max(max, pick(s) || 0), 0);

  const checks: [Parameters<typeof recordPR>[0], number, string][] = [
    ['strictPullUpMax', best('strict-pull-up', setReps), 'reps'],
    ['chinUpMax', best('chin-up', setReps), 'reps'],
    ['pushUpMaxSet', best('standard-push-up', setReps), 'reps'],
    ['deadHangMaxSeconds', best('dead-hang', (s) => s.durationSeconds ?? 0), 'seconds'],
    [
      'backwardTreadmillMaxMinutes',
      best('backward-treadmill-walk', (s) => s.treadmillMinutes ?? 0),
      'minutes',
    ],
    [
      'singleLegBalanceMaxSeconds',
      best('single-leg-balance', (s) => s.durationSeconds ?? 0),
      'seconds',
    ],
    [
      'negativeLoweringMaxSeconds',
      best('negative-pull-up', (s) => s.durationSeconds ?? 0),
      'seconds',
    ],
  ];

  for (const [kind, value, unit] of checks) {
    if (value > 0) await recordPR(kind, value, unit, session.id);
  }
}
