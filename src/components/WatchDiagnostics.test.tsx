import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { triggerDownload } from '@/utils/excelExport';
import { WatchDiagnostics } from './WatchDiagnostics';

const native = vi.hoisted(() => ({
  diagnostics: vi.fn(),
  compat: vi.fn(),
  requestWatchDiagnostics: vi.fn(),
}));
vi.mock('@/utils/watchLink', () => ({
  watchLinkSupported: () => true,
  watchCompat: () => native.compat(),
  WatchLink: native,
}));
vi.mock('@capacitor/app', () => ({
  App: { getInfo: async () => ({ version: '1.0.6', build: '7' }) },
}));
vi.mock('@/utils/excelExport', () => ({ triggerDownload: vi.fn().mockResolvedValue(undefined) }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const event = {
  id: '00000000-0000-4000-8000-000000000e01',
  seq: 1,
  device: 'watch',
  type: 'rest.callback',
  at: Date.UTC(2026, 9, 22, 10),
  elapsed: 5,
  boot: 1,
  sessionId: null,
  timerId: null,
  revision: null,
  opId: null,
  data: { delayMs: 420 },
};
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;

beforeEach(async () => {
  vi.clearAllMocks();
  native.diagnostics.mockResolvedValue({
    events: [event],
    summary: {
      phone: { count: 3, oldestAt: Date.UTC(2026, 9, 20) },
      watch: { count: 1, oldestAt: event.at, lastRetrievedAt: event.at },
    },
  });
  native.compat.mockResolvedValue({
    phoneProtocols: [1, 2],
    peer: {
      nodeId: 'n',
      name: 'Watch',
      reachable: true,
      protocols: [1, 2],
      versionName: '0.5.0',
      versionCode: 5,
      helloAt: 1,
    },
    sharedMode: true,
    reason: 'ok',
  });
  host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root.render(<WatchDiagnostics />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it('summarises both devices and lists the latest events', () => {
  expect(native.diagnostics).toHaveBeenCalledWith({ limit: 100 });
  expect(host.textContent).toContain('Phone: 3 events');
  expect(host.textContent).toContain('Watch: 1 events');
  expect(host.textContent).toContain('rest.callback');
  expect(host.textContent).toContain('"delayMs":420');
});

it('exports JSON through the existing share flow', async () => {
  await act(async () => button('Export diagnostics').click());
  await act(async () => {
    await vi.waitFor(() => expect(host.textContent).toContain('Exported'));
  });
  expect(triggerDownload).toHaveBeenCalledOnce();
  const [blob, name] = vi.mocked(triggerDownload).mock.calls[0]!;
  expect(name).toMatch(/^ironpath-diagnostics-\d{4}-\d{2}-\d{2}\.json$/);
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob as Blob);
  });
  const body = JSON.parse(text);
  expect(body).toMatchObject({
    format: 'ironpath-diagnostics',
    version: 1,
    phone: { versionCode: 7, protocols: [1, 2] },
    watch: { versionName: '0.5.0', versionCode: 5, lastRetrievedAt: event.at },
    compat: { sharedMode: true },
    events: [event],
  });
  expect(host.textContent).toContain('Exported ironpath-diagnostics-');
});

it('explains why watch events cannot be fetched from an old watch', async () => {
  native.requestWatchDiagnostics.mockResolvedValue({ requested: false, reason: 'legacyWatch' });
  await act(async () => button('Fetch from watch').click());
  expect(host.textContent).toContain('Update the watch app to 0.5.0');
});
