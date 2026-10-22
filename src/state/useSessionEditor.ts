import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { commitSessionPatch, getSession } from '@/db/repository';
import { applySessionPatch, diffSession, patchIsEmpty } from '@/watch/mutations';
import type { SessionPatch } from '@/watch/mutations';
import type { WorkoutSession } from '@/types';

export interface SessionEditorOptions {
  /** Session already read by the caller; edits work before the live query resolves. */
  initial?: WorkoutSession | null;
  /** Throws to refuse a commit (legacy watch ownership). */
  guard?: () => Promise<void>;
  /** The edit raced a watch import on the same field; a review was recorded. */
  onConflict?: (reviewId: string | undefined) => void;
  /** Storage failure, refusal or a closed workout; the edit was not saved. */
  onError?: (error: unknown) => void;
  /** A patch reached canonical history (for example, to refresh the watch). */
  onCommitted?: () => void;
}

const newer = (a: WorkoutSession | undefined, b: WorkoutSession | undefined) =>
  !a ? b : !b ? a : (b.syncRevision ?? 0) >= (a.syncRevision ?? 0) ? b : a;

/** Live canonical session with uncommitted patches re-applied; conflicting ones drop out. */
function rebase(base: WorkoutSession | undefined, pending: SessionPatch[]) {
  let session = base;
  for (const patch of pending) {
    if (!session) break;
    const applied = applySessionPatch(session, patch);
    if (applied.state === 'committed') session = applied.session;
  }
  return session;
}

/**
 * Rebasing editor for the active workout (design §2.6). Edits become field-level
 * patches committed in FIFO order through `commitSessionPatch`, so a watch import
 * never discards them and untouched fields follow the live database.
 */
export function useSessionEditor(
  sessionId: string | undefined,
  options: SessionEditorOptions = {},
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const live = useLiveQuery(() => (sessionId ? getSession(sessionId) : undefined), [sessionId]);
  const latest = useRef<WorkoutSession | undefined>(undefined);
  const pendingRef = useRef<SessionPatch[]>([]);
  const [pending, setPending] = useState<SessionPatch[]>([]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const failed = useRef(false);

  if (latest.current && latest.current.id !== sessionId) latest.current = undefined;
  const { initial } = options;
  if (initial && initial.id === sessionId) latest.current = newer(latest.current, initial);
  if (live && live.id === sessionId) latest.current = newer(latest.current, live);
  useEffect(() => {
    pendingRef.current = [];
    setPending([]);
  }, [sessionId]);

  const session = useMemo(
    () => rebase(latest.current, pending),
    // `live` drives `latest`, which is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, pending],
  );

  /** The newest displayed state, including patches queued in this same event batch. */
  const current = useCallback(() => rebase(latest.current, pendingRef.current), []);

  const setQueue = (next: SessionPatch[]) => {
    pendingRef.current = next;
    setPending(next);
  };

  const commit = useCallback(async (id: string, patch: SessionPatch) => {
    try {
      await optionsRef.current.guard?.();
      const result = await commitSessionPatch(id, patch);
      if (result.state === 'closed') throw new Error('Workout was removed or closed.');
      if (result.state === 'conflict') optionsRef.current.onConflict?.(result.reviewId);
      else {
        latest.current = newer(latest.current, result.session);
        optionsRef.current.onCommitted?.();
      }
    } catch (error) {
      failed.current = true;
      optionsRef.current.onError?.(error);
    } finally {
      setQueue(pendingRef.current.filter((row) => row !== patch));
    }
  }, []);

  /**
   * Records `next` (derived from the displayed session) as a patch and commits it.
   * Returns the patch id, or null when nothing changed.
   */
  const change = useCallback(
    (next: WorkoutSession): string | null => {
      const base = current();
      if (!base || !sessionId || next.id !== base.id) return null;
      const patch = diffSession(base, next);
      if (patchIsEmpty(patch) && patch.elapsedSeconds <= base.elapsedSeconds) return null;
      setQueue([...pendingRef.current, patch]);
      chain.current = chain.current.then(() => commit(sessionId, patch));
      return patch.opId;
    },
    [commit, current, sessionId],
  );

  /** Resolves after every queued edit; true if any of them failed since the last flush. */
  const flush = useCallback(async () => {
    await chain.current;
    const result = failed.current;
    failed.current = false;
    return result;
  }, []);

  return { session, current, change, flush };
}
