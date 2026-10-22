import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Minus, Pause, Play, Plus, X } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { useToast } from '@/state/ToastProvider';
import { useStopwatch, REST_PRESETS } from '@/hooks/useTimers';
import { useWorkoutAlerts } from '@/state/WorkoutAlertsProvider';
import { ExerciseCard } from '@/components/ExerciseCard';
import { SupersetGroup } from '@/components/SupersetGroup';
import type { SupersetMember } from '@/components/SupersetGroup';
import { WarmUp } from '@/components/WarmUp';
import { FollowAlongVideo } from '@/components/FollowAlongVideo';
import { EMPTY_PAIN, PainForm } from '@/components/PainScale';
import { Sheet } from '@/components/Sheet';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  allowOfflinePhoneControl,
  beginFinish,
  cancelFinish,
  completeFinish,
  legacyWatchOwns,
  reconcileWatchInbox,
  releaseStaleFreeze,
  watchSelection,
  WatchReviewRequiredError,
  WatchUnavailableError,
} from '@/watch/transport';
import { watchRecoveryActions } from '@/watch/recovery';
import { useSessionEditor } from '@/state/useSessionEditor';
import { WatchWorkoutHandoff } from '@/components/WatchWorkoutHandoff';
import { prescriptionGroups } from '@/utils/workoutExecution';
import { nextUp } from '@/utils/nextUp';
import {
  completeSession,
  createSession,
  currentDay,
  findInProgressSession,
  getSession,
  getPlanById,
  getSuggestions,
  recordPR,
  saveSessionElapsed,
  saveSuggestions,
} from '@/db/repository';
import { detectProgressions } from '@/utils/progression';
import { programFor } from '@/data/programs';
import {
  evaluateDoubleProgression,
  lastPerformance,
  previousHints,
  previousResult,
  recentPerformances,
} from '@/utils/doubleProgression';
import type { BandLabels } from '@/utils/doubleProgression';
import { formatDuration, performedExerciseId, sessionProgress, setReps } from '@/utils/stats';
import { db } from '@/db/db';
import type {
  ExercisePrescription,
  ExerciseResult,
  PainEntry,
  WorkoutDay,
  WorkoutSession,
  WorkoutPlan,
} from '@/types';

export default function WorkoutScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { plan: activePlan, settings, sessions } = useAppData();
  const { toast } = useToast();

  const [loaded, setLoaded] = useState<WorkoutSession | null>(null);
  const [sessionPlan, setSessionPlan] = useState<WorkoutPlan | undefined>();
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [painBeforeOpen, setPainBeforeOpen] = useState(false);
  const [painAfterOpen, setPainAfterOpen] = useState(false);
  const [painDraft, setPainDraft] = useState<PainEntry>(EMPTY_PAIN);
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);

  const stopwatch = useStopwatch(0, false);
  const { rest } = useWorkoutAlerts();
  const watch = useLiveQuery(watchSelection, [], undefined);
  // Edits are field-level patches against the live session, so watch imports and
  // phone input merge instead of overwriting each other (sync v2 §2.3).
  const editor = useSessionEditor(loaded?.id, {
    initial: loaded,
    guard: async () => {
      if (legacyWatchOwns(await watchSelection(), loaded?.id))
        throw new Error('Take control on the phone before editing this workout.');
    },
    onConflict: () =>
      toast('This set changed on your watch. Your phone edit was kept for review below.'),
    onError: () =>
      toast('This change could not be saved. Review the latest workout values and retry.'),
    // Shared mode: publish the change to the watch now rather than on the next poll.
    onCommitted: () => void reconcileWatchInbox().catch(() => {}),
  });
  const session = editor.session ?? loaded;
  const plan = session
    ? activePlan?.id === session.planId
      ? activePlan
      : sessionPlan
    : activePlan;
  // Only a v1 handoff locks the phone; shared mode edits from both screens.
  const watchLocked = legacyWatchOwns(watch, session?.id);

  /* ---------------------------------------------------------- loading */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const found = sessionId ? await getSession(sessionId) : await findInProgressSession();
      const owner = found ? await getPlanById(found.planId) : undefined;
      if (cancelled) return;
      setLoaded(found ?? null);
      setSessionPlan(owner);
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

  // A freeze left behind by a closed or crashed screen would keep the watch frozen.
  const loadedId = loaded?.id;
  useEffect(() => {
    if (loadedId) void releaseStaleFreeze(loadedId, finishingRef.current).catch(() => {});
  }, [loadedId]);

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
      void saveSessionElapsed(sessionId_, elapsedRef.current).catch(() => {});
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
      session
        ? sessions.filter(
            (s) =>
              s.id !== session.id && s.planId === session.planId && s.startedAt < session.startedAt,
          )
        : [],
    [sessions, session],
  );

  // A completing set's patch id identifies the rest it starts (ExerciseCard calls
  // onRest right after onChange); un-ticking that set skips the rest again.
  const completionOps = useRef(new Map<string, string>());
  const pendingRestSource = useRef<string | null>(null);
  const trackRestSource = (
    previous: ExerciseResult | undefined,
    next: ExerciseResult,
    opId: string | null,
  ) => {
    for (const set of next.sets) {
      const before = previous?.sets.find((row) => row.id === set.id);
      if (!set.id || !before || before.completed === set.completed) continue;
      if (set.completed && opId) {
        completionOps.current.set(set.id, opId);
        pendingRestSource.current = opId;
        // Only a rest started in this same handler belongs to the set.
        queueMicrotask(() => {
          if (pendingRestSource.current === opId) pendingRestSource.current = null;
        });
      } else if (!set.completed) {
        const source = completionOps.current.get(set.id);
        completionOps.current.delete(set.id);
        if (source && rest.remaining != null && rest.sourceOp === source) rest.stop();
      }
    }
  };

  /** Applies a partial change against the LIVE session, never a render closure. */
  const patchSession = (patch: Partial<WorkoutSession>) => {
    const current = editor.current();
    if (!current || finishingRef.current) return;
    editor.change({ ...current, ...patch, elapsedSeconds: elapsedRef.current });
  };

  const updateResult = (next: ExerciseResult) => {
    const current = editor.current();
    if (!current || finishingRef.current) return;
    const previous = current.results.find((r) => r.prescriptionId === next.prescriptionId);
    const results = current.results.map((r) =>
      r.prescriptionId === next.prescriptionId ? next : r,
    );
    const opId = editor.change({ ...current, results, elapsedSeconds: elapsedRef.current });
    trackRestSource(previous, next, opId);

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
    const current = editor.current() ?? loaded;
    // Finishing takes several async round-trips; without this guard a second tap
    // re-enters and advances the plan cursor twice, dropping a training day.
    if (!current || finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    let finished: WorkoutSession;
    let checkingWatch = true;
    try {
      if (await editor.flush())
        throw new Error(
          'Some phone edits could not be saved. Review the latest values before finishing.',
        );
      // Shared mode freezes both screens and imports through the watch checkpoint;
      // a legacy handoff takes control with the v1 pause.
      try {
        await beginFinish(current.id);
      } catch (error) {
        if (
          !(error instanceof WatchUnavailableError) ||
          !window.confirm(
            'The watch has not confirmed all saved sets. Complete this workout without them? Later arrivals will be kept for review and will not change this completed workout.',
          )
        )
          throw error;
        // The queued freeze and closure stay in the outbox for the watch.
        await allowOfflinePhoneControl(current.id);
        if ((await watchRecoveryActions(current.id)).length)
          throw new WatchReviewRequiredError('Review the saved watch actions before finishing.');
      }
      const latest = await getSession(current.id);
      if (!latest || latest.status !== 'inProgress')
        throw new Error('This workout was removed or already completed.');
      finished = {
        ...latest,
        status: 'completed',
        completedAt: new Date().toISOString(),
        painAfter: painDraft,
        elapsedSeconds: elapsedRef.current,
      };
      checkingWatch = false;
      finished = await completeSession(finished);
      await completeFinish(current.id).catch(() => {});
      rest.stop();
      void reconcileWatchInbox().catch(() => {});
    } catch (error) {
      // Cancelled or failed finishing restores normal shared editing.
      void cancelFinish(current.id, '').catch(() => {});
      finishingRef.current = false;
      setFinishing(false);
      toast(
        checkingWatch && error instanceof Error
          ? error.message
          : 'Could not save workout. Please try again.',
      );
      return;
    }
    // Records and suggestions are derived data: a failure here must not leave
    // an already saved workout stuck behind a permanently disabled Finish button.
    try {
      await capturePRs(finished);
      const existing = await getSuggestions();
      const all = await db.sessions.where('planId').equals(finished.planId).toArray();
      const sessionPlan = await getPlanById(finished.planId);
      const fresh = detectProgressions(
        [...all.filter((s) => s.id !== finished.id), finished].sort((a, b) =>
          a.startedAt.localeCompare(b.startedAt),
        ),
        existing,
        sessionPlan,
      );
      if (fresh.length) await saveSuggestions(fresh);
      toast(
        fresh.length
          ? `Workout saved · ${fresh.length} progression suggestion${fresh.length > 1 ? 's' : ''}`
          : 'Workout saved',
      );
    } catch {
      toast('Workout saved. Records or suggestions could not be updated.');
    }
    setPainAfterOpen(false);
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
    const previous = previousResult(priorSessions, exerciseId);
    const verdict = evaluateDoubleProgression(prescription, previous);
    return {
      prescription,
      result,
      previous: previousHints(priorSessions, exerciseId),
      history: recentPerformances(priorSessions, exerciseId, 3),
      lastSnapshot: lastPerformance(priorSessions, exerciseId),
      // Only a 'ready' verdict renders; anything else stays out of the way.
      verdict: verdict.status === 'ready' ? verdict : null,
    };
  });
  const nextExercise = session.results.find((r) => !r.completed && !r.skippedReason);
  /** Reads the live session, so the set just logged already counts as done. */
  const upcoming = () => {
    const current = editor.current() ?? session;
    return nextUp(
      day,
      current,
      (exerciseId) => previousResult(priorSessions, exerciseId),
      settings.weightUnit,
      settings.bandLabels,
    );
  };
  const startRest = (seconds: number) => {
    const sourceOp = pendingRestSource.current ?? undefined;
    pendingRestSource.current = null;
    rest.start(seconds, upcoming(), { sessionId: session.id, sourceOp });
  };
  const restNext = rest.remaining != null ? upcoming() : null;
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

      <WatchWorkoutHandoff key={session.id} sessionId={session.id} />

      <fieldset
        disabled={watchLocked || finishing}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <WarmUp
          items={session.warmUp}
          catalog={programFor(plan).warmUp}
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
                      onRest={startRest}
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
                        previous={member.previous}
                        history={member.history}
                        verdict={member.verdict}
                        isCurrent={nextExercise?.prescriptionId === member.prescription.id}
                        expanded={expanded === member.prescription.id}
                        onToggleExpand={() =>
                          setExpanded(
                            expanded === member.prescription.id ? null : member.prescription.id,
                          )
                        }
                        onChange={updateResult}
                        onRest={startRest}
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
      </fieldset>

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
          {rest.destination && rest.destination !== 'phone' && (
            <span className="muted tiny">
              {rest.destination === 'watch'
                ? 'Alert on your watch'
                : rest.destination === 'both'
                  ? 'Alert on watch and phone'
                  : 'No alert'}
            </span>
          )}
          {restNext && (
            <div className="rest-next">
              <span className="muted tiny">
                {restNext.kind === 'set' ? 'Next set' : 'Next exercise'}
              </span>
              <strong>{restNext.title}</strong>
              <span className="tiny">{restNext.detail}</span>
            </div>
          )}
          <div className="row tight">
            {REST_PRESETS.map((p) => (
              <button key={p} className="btn small" onClick={() => startRest(p)}>
                {p}s
              </button>
            ))}
          </div>
          <div className="row tight">
            <button className="btn small" onClick={() => rest.add(-15)}>
              <Minus size={14} /> 15s
            </button>
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
  for (const group of prescriptionGroups(day)) {
    const first = group[0]!;
    const members = group.flatMap((prescription) => {
      const result = session.results.find((r) => r.prescriptionId === prescription.id);
      return result ? [memberFor(prescription, result)] : [];
    });
    if (!members.length) continue;
    let block = blocks[blocks.length - 1];
    if (!block || block.label !== first.blockLabel) {
      block = { label: first.blockLabel, units: [] };
      blocks.push(block);
    }
    block.units.push({ supersetKey: first.supersetKey ?? null, members });
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
