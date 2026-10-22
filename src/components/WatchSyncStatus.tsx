import { useEffect, useState } from 'react';
import { watchSyncStatus } from '@/watch/transport';
import type { PhoneWatchStatus } from '@/watch/transport';
import { WatchLink, watchLinkSupported } from '@/utils/watchLink';

type Pill = { label: string; tone: '' | 'accent' | 'green' | 'red'; detail: string };

/** One state, by priority: link problems first, then the §6.2 sync priority. */
export function syncPill(status: PhoneWatchStatus): Pill | null {
  if (status.link === 'off') return null;
  if (status.link === 'updateRequired')
    return {
      label: 'Update needed',
      tone: 'red',
      detail: 'Update the watch app to 0.5.0 to log from both screens.',
    };
  if (status.link === 'offline' && status.sync === 'synced')
    return {
      label: 'Offline',
      tone: '',
      detail: 'The watch is out of reach. Its actions are saved and sync when it reconnects.',
    };
  switch (status.sync) {
    case 'needsReview':
      return {
        label: 'Needs review',
        tone: 'red',
        detail: `${status.reviews} change${status.reviews === 1 ? '' : 's'} need${status.reviews === 1 ? 's' : ''} review below.`,
      };
    case 'waitingForPhone':
      return {
        label: 'Waiting for phone',
        tone: 'accent',
        detail: 'Watch actions arrived and are being saved to your workout.',
      };
    case 'savedOnWatch':
      return {
        label: 'Saved on watch',
        tone: 'accent',
        detail: `${status.pendingOnWatch} watch action${status.pendingOnWatch === 1 ? ' is' : 's are'} saved on the watch and will sync.`,
      };
    default:
      return { label: 'Synced', tone: 'green', detail: 'Phone and watch show the same workout.' };
  }
}

export function WatchSyncStatus({ status }: { status: PhoneWatchStatus | null }) {
  const pill = status && syncPill(status);
  if (!pill) return null;
  return (
    <p role="status" className="row tight" style={{ alignItems: 'center' }}>
      <span className={`pill ${pill.tone}`}>{pill.label}</span>
      <span className="muted tiny">{pill.detail}</span>
    </p>
  );
}

/** Polls every 2 s and refreshes immediately on native `workChanged`. */
export function useWatchSyncStatus(sessionId?: string): PhoneWatchStatus | null {
  const [status, setStatus] = useState<PhoneWatchStatus | null>(null);
  useEffect(() => {
    if (!watchLinkSupported()) return undefined;
    let disposed = false;
    const refresh = () =>
      void watchSyncStatus(sessionId)
        .then((value) => {
          if (!disposed) setStatus(value);
        })
        .catch(() => {});
    refresh();
    const interval = window.setInterval(refresh, 2000);
    const handle = WatchLink.addListener('workChanged', refresh).catch(() => null);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      void handle.then((h) => h?.remove()).catch(() => {});
    };
  }, [sessionId]);
  return status;
}
