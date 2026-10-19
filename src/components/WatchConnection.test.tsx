import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WatchConnection } from './WatchConnection';

const mocks = vi.hoisted(() => ({ supported: true, ping: vi.fn(), inspect: vi.fn() }));
vi.mock('@/utils/watchLink', () => ({
  watchLinkSupported: () => mocks.supported,
  WatchLink: { ping: mocks.ping, inspect: mocks.inspect },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.supported = true;
  mocks.ping.mockResolvedValue({ id: 'test-id' });
  mocks.inspect.mockResolvedValue({ peers: [], receipts: [] });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function start() {
  await act(async () => root.render(<WatchConnection />));
  await act(async () => host.querySelector('button')!.click());
}

describe('watch connection diagnostics', () => {
  it('does not expose a native-only action in a browser', async () => {
    mocks.supported = false;
    await act(async () => root.render(<WatchConnection />));
    expect(host.textContent).toBe('');
  });
  it('does not treat transport delivery or an old pong as a verified connection', async () => {
    mocks.inspect.mockResolvedValue({ receipts: [{ id: 'old-id', type: 'pong' }] });
    await start();
    expect(host.textContent).not.toContain('Connection verified');
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(host.textContent).toContain('No reply yet');
    expect(host.querySelector('button')!.disabled).toBe(false);
  });
  it('verifies only a reply matching the current request', async () => {
    mocks.inspect.mockResolvedValue({ receipts: [{ id: 'test-id', type: 'pong' }] });
    await start();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(host.textContent).toContain('Watch replied. Connection verified.');
  });
  it('recovers the button after a native failure', async () => {
    mocks.ping.mockRejectedValue(new Error('Unavailable'));
    await start();
    expect(host.textContent).toContain('Connection test failed');
    expect(host.querySelector('button')!.disabled).toBe(false);
  });
});
