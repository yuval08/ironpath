import { useEffect, useRef, useState } from 'react';
import { WatchLink, watchLinkSupported } from '@/utils/watchLink';
import {
  sendWorkoutToWatch,
  takePhoneControl,
  allowOfflinePhoneControl,
  isSharedSelection,
  watchSelection,
  WatchUnavailableError,
  consumeTransferredRest,
} from '@/watch/transport';
import type { WatchSelection } from '@/watch/transport';
import { useLiveQuery } from 'dexie-react-hooks';
import { WatchRecovery } from './WatchRecovery';
import { WatchSyncStatus, useWatchSyncStatus } from './WatchSyncStatus';
import { db } from '@/db/db';
import { WATCH_SELECTED_KEY } from '@/watch/sessionSync';
import { useWorkoutAlerts } from '@/state/WorkoutAlertsProvider';

export function WatchWorkoutHandoff({ sessionId }: { sessionId: string }) {
  const selected = useLiveQuery(watchSelection, [], undefined);
  const [busy, setBusy] = useState(false);
  const { rest } = useWorkoutAlerts();
  const [message, setMessage] = useState('Send this workout to see it on your watch.');
  const status = useWatchSyncStatus(sessionId);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!watchLinkSupported()) return null;
  const send = async () => {
    setBusy(true);
    setMessage('Sending workout…');
    try {
      const id = await sendWorkoutToWatch(sessionId);
      for (let i = 0; i < 10 && mounted.current; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        if (!mounted.current) return;
        const report = await WatchLink.inspectWorkout();
        const selected = (await db.meta.get(WATCH_SELECTED_KEY))?.value as
          WatchSelection | undefined;
        if (!mounted.current) return;
        const saved =
          selected && isSharedSelection(selected)
            ? 'Workout on your watch. Log sets and rest from either screen.'
            : 'Workout saved on your watch. You can log sets and rest from your wrist.';
        if (selected?.snapshotId === id && selected.confirmed) {
          setMessage(saved);
          return;
        }
        if (report.confirmation?.id === id) {
          const body = report.confirmation.body;
          setMessage(
            body.state === 'received'
              ? saved
              : body.code === 'pending'
                ? 'Waiting for the watch to finish syncing the previous workout.'
                : body.reason,
          );
          if (body.code !== 'pending') return;
        }
      }
      if (mounted.current)
        setMessage('Waiting for watch confirmation. Reopen Ironpath on the watch and retry.');
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'Could not send this workout.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const shared = !!selected && isSharedSelection(selected);
  // Take control exists only for a v1 handoff (a watch app older than 0.5.0).
  const legacy = selected?.sessionId === sessionId && !shared;
  const owns =
    legacy && (!selected.owner || selected.owner === 'watch' || selected.owner === 'pausing');
  const switching = shared && selected.sessionId !== sessionId;
  const restBlocksSend = !shared && status?.link !== 'shared' && rest.remaining != null;
  const takeControl = async () => {
    setBusy(true);
    setMessage('Pausing watch logging and syncing saved sets…');
    try {
      await takePhoneControl(sessionId);
      setMessage(
        'Phone has control. Watch logging and its rest alert are paused. Resume any remaining rest below.',
      );
    } catch (error) {
      if (
        error instanceof WatchUnavailableError &&
        window.confirm(
          'The watch has not confirmed its saved sets. It may still accept actions offline. Continue on the phone? Later conflicts will be saved for review.',
        )
      ) {
        await allowOfflinePhoneControl(sessionId);
        setMessage(
          'Phone control enabled offline. The watch may still accept actions until it reconnects.',
        );
      } else setMessage(error instanceof Error ? error.message : 'Could not take control. Retry.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      <div className="card">
        <h3>Galaxy Watch</h3>
        <WatchSyncStatus status={status} />
        <p role="status">{message}</p>
        {owns && (
          <p>
            <strong>Watch control active.</strong> Take control here before editing sets on the
            phone.
          </p>
        )}
        {selected?.sessionId === sessionId && selected.offline && !shared && (
          <p>The watch has not confirmed the transfer. Later watch actions can require review.</p>
        )}
        {legacy && (
          <button className="btn" disabled={busy} onClick={() => void takeControl()}>
            {busy ? 'Syncing…' : 'Take control on phone / sync watch'}
          </button>
        )}
        {legacy && selected.owner === 'phone' && selected.restTransfer && (
          <button
            className="btn"
            disabled={busy || rest.remaining != null}
            onClick={() => {
              setBusy(true);
              void consumeTransferredRest(sessionId, selected.restTransfer!.id)
                .then((seconds) => {
                  rest.start(seconds);
                  setMessage('Rest resumed on phone.');
                })
                .catch((error) =>
                  setMessage(error instanceof Error ? error.message : 'Could not resume rest.'),
                )
                .finally(() => setBusy(false));
            }}
          >
            Resume paused watch rest ({selected.restTransfer.seconds}s)
          </button>
        )}
        <button className="btn" disabled={busy || restBlocksSend} onClick={() => void send()}>
          {busy ? 'Sending…' : switching ? 'Switch watch to this workout' : 'Send workout to watch'}
        </button>
        <p className="muted tiny">
          {restBlocksSend
            ? 'Finish or skip the current phone rest before sending the workout.'
            : shared
              ? 'Log sets, undo and control rest from either screen. Watch actions saved offline sync when the phone app resumes.'
              : 'Complete sets on your watch. Actions are saved locally and imported when the phone app resumes.'}
        </p>
      </div>
      <WatchRecovery sessionId={sessionId} />
    </>
  );
}
