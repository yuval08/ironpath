import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import type { PhoneWatchStatus } from '@/watch/transport';
import { syncPill, WatchSyncStatus } from './WatchSyncStatus';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const base: PhoneWatchStatus = {
  link: 'shared',
  sync: 'synced',
  pendingOnWatch: 0,
  inbox: 0,
  reviews: 0,
  peer: { versionName: '0.5.0', protocols: [1, 2] },
  lastWatchStatusAt: null,
};

it.each([
  [{}, 'Synced'],
  [{ sync: 'savedOnWatch', pendingOnWatch: 2 }, 'Saved on watch'],
  [{ sync: 'waitingForPhone', inbox: 1 }, 'Waiting for phone'],
  [{ sync: 'needsReview', reviews: 1 }, 'Needs review'],
  [{ link: 'updateRequired' }, 'Update needed'],
  [{ link: 'offline' }, 'Offline'],
  [{ link: 'offline', sync: 'savedOnWatch', pendingOnWatch: 1 }, 'Saved on watch'],
] as const)('shows %j as %s', (patch, label) => {
  expect(syncPill({ ...base, ...patch })!.label).toBe(label);
});

it('renders nothing without a watch and a labelled pill otherwise', async () => {
  expect(syncPill({ ...base, link: 'off' })).toBeNull();
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(<WatchSyncStatus status={{ ...base, sync: 'needsReview', reviews: 2 }} />),
  );
  expect(host.querySelector('.pill')!.textContent).toBe('Needs review');
  expect(host.textContent).toContain('2 changes need review');
  await act(async () => root.render(<WatchSyncStatus status={null} />));
  expect(host.textContent).toBe('');
  await act(async () => root.unmount());
});
