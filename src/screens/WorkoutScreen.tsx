import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Pause, Play, Plus, X } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { useToast } from '@/state/ToastProvider';
import { useRestTimer, useStopwatch, REST_PRESETS } from '@/hooks/useTimers';
import { ExerciseCard } from '@/components/ExerciseCard';
import { SupersetGroup } from '@/components/SupersetGroup';
import type { SupersetMember } from '@/components/SupersetGroup';
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
import { programFor } from '@/data/programs';
import { evaluateDoubleProgression, lastPerformance } from '@/utils/doubleProgression';
import type { BandLabels } from '@/utils/doubleProgression';
import { formatDuration, performedExerciseId, sessionProgress, setReps } from '@/utils/stats';
import { db } from '@/db/db';
import type {
  ExercisePrescription,
  ExerciseResult,
  PainEntry,
  WorkoutDay,
  WorkoutSession,
} from '@/types';

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
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);

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
  // The live elapsed value is read through a ref so the writer below is not keyed
  // on it — an effect that re-runs every tick can never let its own timeout fire.
  const elapsedRef = useRef(stopwatch.elapsed);
  elapsedRef.current = stopwatch.elapsed;

  const sessionId_ = session?.id;
  const sessionStatus = session?.status;
  const timerRunning = stopwatch.running;

  useEffect(() => {
    if (!sessionId_ || sessionStatus !== 'inProgress') return undefined;

    const flush = () => {
      void db.sessions.update(sessionId_, { elapsedSeconds: elapsedRef.current });
    };
    const interval = window.setInterval(flush, 5000);
    // Backgrounding on iOS can discard the tab outright — persist on the way out.
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [sessionId_, sessionStatus, timerRunning]);

  /**
   * `session` lives in local state and every write puts the whole document, so a
   * second window (installed app + a browser tab) would clobber the other's sets.
   * Re-reading whenever this tab becomes active makes the later writer start from
   * the newer document instead of a stale one.
   */
  useEffect(() => {
    if (!sessionId_) return undefined;
    const resync = () => {
      if (document.visibilityState !== 'visible') return;
      void getSession(sessionId_).then((fresh) => {
        if (!fresh) return;
        const mine = sessionRef.current;
        if (mine && fresh.updatedAt <= mine.updatedAt) return;
        sessionRef.current = fresh;
        setSession(fresh);
      });
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    return () => {
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
    };
  }, [sessionId_]);

  const day: WorkoutDay | undefined = useMemo(() => {
    if (!plan || !session) return undefined;
    return plan.weeks
      .find((w) => w.weekNumber === session.weekNumber)
      ?.days.find((d) => d.id === session.dayId);
  }, [plan, session]);

  /**
   * History and progression are read from the same plan only: a verdict is about
   * a prescription in this program, and mixing another block's loads into the
   * "last session" line would read as a regression that never happened.
   */
  const priorSessions = useMemo(
    () =>
      session ? sessions.filter((s) => s.id !== session.id && s.planId === session.planId) : [],
    [sessions, session],
  );

  // Mirrors `session` so writers never rebuild from a stale render closure — two
  // set-taps landing in one React batch would otherwise lose the first one.
  const sessionRef = useRef<WorkoutSession | null>(null);
  sessionRef.current = session;

  const persist = useCallback(async (next: WorkoutSession) => {
    sessionRef.current = next;
    setSession(next);
    await saveSession(next);
  }, []);

  /** Applies a partial change against the LIVE session, never a render closure. */
  const patchSession = (patch: Partial<WorkoutSession>) => {
    const current = sessionRef.current;
    if (!current) return;
    void persist({ ...current, ...patch, elapsedSeconds: elapsedRef.current });
  };

  const updateResult = (next: ExerciseResult) => {
    const current = sessionRef.current;
    if (!current) return;
    const previous = current.results.find((r) => r.prescriptionId === next.prescriptionId);
    const results = current.results.map((r) =>
      r.prescriptionId === next.prescriptionId ? next : r,
    );
    void persist({ ...current, results, elapsedSeconds: elapsedRef.current });

    // Only collapse on the false -> true transition. Notes, pain, form and
    // substitution all arrive through this same handler, so re-running it on
    // every change would shut the card on the first keystroke.
    if (next.completed && !previous?.completed && settings?.autoCollapseCompleted) {
      const nextOpen = results.find((r) => !r.completed && !r.skippedReason);
      setExpanded(nextOpen?.prescriptionId ?? null);
    }
  };

  /**
   * Opens one exercise and brings it under the thumb. Used both by the sticky
   * "Next exercise" button and by a superset walking A1 -> A2, so the two cannot
   * drift apart.
   */
  const focusExercise = useCallback((prescriptionId: string) => {
    setExpanded(prescriptionId);
    // The card is already mounted; wait a frame so the freshly expanded body is
    // laid out before scrolling, otherwise it lands off-centre.
    requestAnimationFrame(() => {
      document
        .getElementById(`ex-${prescriptionId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  const startFresh = async () => {
    if (!plan || !settings) return;
    const target = currentDay(plan);
    if (!target) return;
    const created = await createSession(plan, target, settings.weightOverrides);
    navigate(`/workout/${created.id}`, { replace: true });
  };

  const finish = async () => {
    const current = sessionRef.current;
    // Finishing takes several async round-trips; without this guard a second tap
    // re-enters and advances the plan cursor twice, dropping a training day.
    if (!current || finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    const finished: WorkoutSession = {
      ...current,
      painAfter: painDraft,
      elapsedSeconds: elapsedRef.current,
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
  const blocks = buildBlocks(day, session, (prescription, result) => {
    const exerciseId = performedExerciseId(result);
    const previous = previousResultFor(priorSessions, exerciseId);
    const verdict = evaluateDoubleProgression(prescription, previous);
    return {
      prescription,
      result,
      lastSnapshot: lastPerformance(priorSessions, exerciseId),
      // Only a 'ready' verdict renders; anything else stays out of the way.
      verdict: verdict.status === 'ready' ? verdict : null,
    };
  });
  const nextExercise = session.results.find((r) => !r.completed && !r.skippedReason);
  // Deliberately partial: the user renames only the bands they own, and every
  // consumer resolves a missing key through `bandName`'s default.
  const bandLabels: BandLabels = settings.bandLabels;
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
        catalog={programFor(plan.programId).warmUp}
        finished={warmUpDone}
        onChange={(warmUp) => patchSession({ warmUp })}
        onFinish={() => {
          patchSession({ warmUpCompletedAt: new Date().toISOString() });
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
        blocks.map((block) => {
          // A lone superset names itself in its own header — a block heading above
          // it would just repeat 'Superset A'.
          const soloSuperset = block.units.length === 1 && block.units[0]?.supersetKey != null;
          return (
            <div key={block.label}>
              {!soloSuperset && <div className="block-head">{block.label}</div>}
              {block.units.map((unit) =>
                unit.supersetKey != null && unit.members.length > 1 ? (
                  <SupersetGroup
                    key={unit.supersetKey}
                    members={unit.members}
                    weightUnit={settings.weightUnit}
                    bandLabels={bandLabels}
                    expandedId={expanded}
                    currentId={nextExercise?.prescriptionId ?? null}
                    onToggleExpand={(id) => setExpanded(expanded === id ? null : id)}
                    onFocus={focusExercise}
                    autoAdvance={settings.autoCollapseCompleted}
                    onChange={updateResult}
                    onRest={(seconds) => rest.start(seconds)}
                  />
                ) : (
                  unit.members.map((member) => (
                    <ExerciseCard
                      key={member.prescription.id}
                      prescription={member.prescription}
                      result={member.result}
                      weightUnit={settings.weightUnit}
                      bandLabels={bandLabels}
                      lastSnapshot={member.lastSnapshot}
                      verdict={member.verdict}
                      isCurrent={nextExercise?.prescriptionId === member.prescription.id}
                      expanded={expanded === member.prescription.id}
                      onToggleExpand={() =>
                        setExpanded(
                          expanded === member.prescription.id ? null : member.prescription.id,
                        )
                      }
                      onChange={updateResult}
                      onRest={(seconds) => rest.start(seconds)}
                    />
                  ))
                ),
              )}
            </div>
          );
        })}

      {warmUpDone && (
        <div className="card" style={{ marginTop: 16 }}>
          <label className="field">
            Session notes
            <textarea
              value={session.sessionNotes}
              onChange={(e) => patchSession({ sessionNotes: e.target.value })}
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
                patchSession({
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
            onClick={() => focusExercise(nextExercise.prescriptionId)}
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
            patchSession({ painBefore: painDraft });
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
        <button className="btn primary block" disabled={finishing} onClick={() => void finish()}>
          {finishing ? 'Saving…' : 'Save & complete workout'}
        </button>
      </Sheet>
    </div>
  );
}

interface Unit {
  /** Set when the members are an explicit superset; null for a straight exercise. */
  supersetKey: string | null;
  members: SupersetMember[];
}

interface Block {
  label: string;
  units: Unit[];
}

/**
 * Splits the day into what is actually performed: blocks for the visual heading,
 * and inside them units — a superset (prescriptions sharing `supersetKey`) or a
 * single exercise. Only consecutive prescriptions group, so a program that reuses
 * a key later in the day still gets two separate supersets.
 */
function buildBlocks(
  day: WorkoutDay | undefined,
  session: WorkoutSession,
  memberFor: (prescription: ExercisePrescription, result: ExerciseResult) => SupersetMember,
): Block[] {
  if (!day) return [];
  const blocks: Block[] = [];
  for (const prescription of [...day.prescriptions].sort((a, b) => a.order - b.order)) {
    const result = session.results.find((r) => r.prescriptionId === prescription.id);
    if (!result) continue;
    const member = memberFor(prescription, result);
    const key = prescription.supersetKey ?? null;

    let block = blocks[blocks.length - 1];
    if (!block || block.label !== prescription.blockLabel) {
      block = { label: prescription.blockLabel, units: [] };
      blocks.push(block);
    }
    const unit = block.units[block.units.length - 1];
    if (key != null && unit && unit.supersetKey === key) unit.members.push(member);
    else block.units.push({ supersetKey: key, members: [member] });
  }
  return blocks;
}

/** The most recent logged result for an exercise, ignoring skips and this session. */
function previousResultFor(sessions: WorkoutSession[], exerciseId: string): ExerciseResult | null {
  const ordered = [...sessions].sort((a, b) =>
    `${b.date}${b.startedAt}`.localeCompare(`${a.date}${a.startedAt}`),
  );
  for (const session of ordered) {
    if (session.status === 'abandoned') continue;
    const match = session.results.find(
      (r) => r.skippedReason == null && performedExerciseId(r) === exerciseId,
    );
    if (match) return match;
  }
  return null;
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
