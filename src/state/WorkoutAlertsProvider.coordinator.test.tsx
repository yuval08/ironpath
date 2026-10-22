import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeSettings } from '@/test/factories';
import { db } from '@/db/db';
import {
  REST_MIGRATION_KEY,
  WorkoutAlertsProvider,
  useWorkoutAlerts,
} from './WorkoutAlertsProvider';
import { cancelNativeRestAlert, scheduleNativeRestAlert } from '@/utils/nativeRestNotifications';
import { showRestNotification } from '@/utils/restNotifications';
import type { RestView } from '@/watch/restCoordinator';

const mocks = vi.hoisted(() => ({
  data: {} as unknown,
  toast: vi.fn(),
  listeners: new Map<string, (value: unknown) => void>(),
  plugin: {
    getState: vi.fn(),
    start: vi.fn(),
    adjust: vi.fn(),
    skip: vi.fn(),
    configure: vi.fn(),
    closeSession: vi.fn(),
    addListener: vi.fn(),
  },
}));
vi.mock('./AppDataProvider', () => ({ useAppData: () => mocks.data }));
vi.mock('./ToastProvider', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/watch/restCoordinator', () => ({
  restCoordinatorSupported: () => true,
  RestCoordinator: mocks.plugin,
}));
vi.mock('@/watch/diagnostics', () => ({ recordJsDiagnostic: vi.fn() }));
vi.mock('@/utils/nativeRestNotifications', () => ({
  nativeRestNotificationsSupported: () => true,
  scheduleNativeRestAlert: vi.fn().mockResolvedValue(true),
  cancelNativeRestAlert: vi.fn().mockResolvedValue(true),
  listenForNativeRestNotification: () => () => {},
}));
vi.mock('@/utils/restNotifications', () => ({
  showRestNotification: vi.fn().mockResolvedValue(true),
  closeRestNotifications: vi.fn().mockResolvedValue(undefined),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: ReturnType<typeof createRoot>;
let rest: ReturnType<typeof useWorkoutAlerts>['rest'];
function View() {
  rest = useWorkoutAlerts().rest;
  return null;
}
async function draw() {
  await act(async () =>
    root.render(
      <StrictMode>
        <WorkoutAlertsProvider>
          <View />
        </WorkoutAlertsProvider>
      </StrictMode>,
    ),
  );
}
const TIMER = '00000000-0000-4000-8000-0000000000aa';
function view(
  remainingMs: number,
  patch: Partial<NonNullable<RestView['timer']>> = {},
  alert: Partial<NonNullable<RestView['timer']>['alert']> = {},
): RestView {
  return {
    measuredAtWall: Date.now(),
    timer: {
      timerId: TIMER,
      revision: 3,
      sessionId: 'session_1',
      state: 'running',
      remainingMs,
      durationMs: 90_000,
      origin: 'watch',
      sourceOp: null,
      next: { title: 'A1 · Bench press', text: 'Set 2 of 4 · 8-12 reps · 60 kg' },
      alert: {
        preferred: 'watch',
        destination: 'watch',
        watchArmedRevision: 3,
        phoneBackup: 'suppressed',
        ...alert,
      },
      ...patch,
    },
  };
}
const emit = async (value: RestView) => {
  await act(async () => mocks.listeners.get('restChanged')!(value));
};

beforeEach(async () => {
  await db.meta.clear();
  // fake-indexeddb schedules with setImmediate; leave it real.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  root = createRoot(document.createElement('div'));
  mocks.listeners.clear();
  mocks.data = { settings: makeSettings({ notifyOnRestEnd: true, vibrateOnRestEnd: true }) };
  mocks.plugin.addListener.mockImplementation(async (event: string, listener) => {
    mocks.listeners.set(event, listener);
    return { remove: vi.fn() };
  });
  mocks.plugin.getState.mockResolvedValue({ measuredAtWall: Date.now(), timer: null });
  for (const method of ['start', 'adjust', 'skip'] as const)
    mocks.plugin[method].mockImplementation(async () => view(60_000, { origin: 'phone' }));
  mocks.plugin.configure.mockResolvedValue({});
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('starts, adjusts and skips through the coordinator, never through LocalNotifications', async () => {
  await draw();
  const next = {
    kind: 'set' as const,
    title: 'A1 · Bench press',
    detail: 'Set 2 of 4 · 8-12 reps',
  };
  await act(async () => rest.start(60, next, { sessionId: 'session_1' }));
  expect(mocks.plugin.start).toHaveBeenCalledWith({
    sessionId: 'session_1',
    durationSeconds: 60,
    sourceOp: null,
    next: { title: 'A1 · Bench press', text: 'Set 2 of 4 · 8-12 reps' },
  });
  expect(rest.remaining).toBe(60);
  await act(async () => rest.add(-15));
  expect(mocks.plugin.adjust).toHaveBeenCalledWith({ timerId: TIMER, deltaSeconds: -15 });
  await act(async () => rest.add(15));
  expect(mocks.plugin.adjust).toHaveBeenLastCalledWith({ timerId: TIMER, deltaSeconds: 15 });
  await act(async () => rest.stop());
  expect(mocks.plugin.skip).toHaveBeenCalledWith({ timerId: TIMER });
  expect(scheduleNativeRestAlert).not.toHaveBeenCalled();
  expect(mocks.plugin.configure).toHaveBeenCalledWith({ notify: true, vibrate: true });
});

it('shows a watch-started rest and toasts the next set without vibrating for a wrist alert', async () => {
  const vibrate = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, vibrate });
  await draw();
  await emit(view(30_000));
  expect(rest.remaining).toBe(30);
  expect(rest.origin).toBe('watch');
  expect(rest.destination).toBe('watch');
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(mocks.toast).toHaveBeenCalledWith(
    'Rest complete — A1 · Bench press, Set 2 of 4 · 8-12 reps · 60 kg.',
  );
  expect(vibrate).not.toHaveBeenCalled();
  expect(showRestNotification).not.toHaveBeenCalled();
  // The native 'ended' echo for the same rest does not alert twice.
  await emit(view(0, { state: 'ended' }));
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(mocks.toast).toHaveBeenCalledTimes(1);
});

it('vibrates in JS only when the phone backup is off and the wrist is not alerting', async () => {
  const vibrate = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, vibrate });
  await draw();
  await emit(view(1_000, { origin: 'phone' }, { destination: 'none', phoneBackup: 'off' }));
  await act(async () => vi.advanceTimersByTime(1_000));
  expect(vibrate).toHaveBeenCalledTimes(1);
});

it('does not alert for a rest that ended before the app saw it running', async () => {
  mocks.plugin.getState.mockResolvedValue(view(0, { state: 'ended' }));
  await draw();
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(rest.remaining).toBeNull();
});

it('cancels the 1.0.5 LocalNotifications rest alarm exactly once', async () => {
  await draw();
  await act(async () => {
    await vi.waitFor(async () => expect(await db.meta.get(REST_MIGRATION_KEY)).toBeDefined());
  });
  expect(cancelNativeRestAlert).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = createRoot(document.createElement('div'));
  await draw();
  await act(async () => vi.advanceTimersByTime(100));
  expect(cancelNativeRestAlert).toHaveBeenCalledTimes(1);
});

it('exposes the source mutation and forwards added time to a rest that just ended', async () => {
  await draw();
  const source = '00000000-0000-4000-8000-0000000000bb';
  await emit(view(1_000, { sourceOp: source }));
  expect(rest.sourceOp).toBe(source);
  await act(async () => vi.advanceTimersByTime(1_000));
  await emit(view(0, { state: 'ended', sourceOp: source }));
  await act(async () => rest.add(30));
  expect(mocks.plugin.adjust).toHaveBeenCalledWith({ timerId: TIMER, deltaSeconds: 30 });
  await act(async () => rest.start(60, null, { sessionId: 'session_1', sourceOp: source }));
  expect(mocks.plugin.start).toHaveBeenLastCalledWith(
    expect.objectContaining({ sourceOp: source }),
  );
});
