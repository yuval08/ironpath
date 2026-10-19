import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeSettings } from '@/test/factories';
import { WorkoutAlertsProvider, useWorkoutAlerts } from './WorkoutAlertsProvider';
import { WorkoutPreferences } from '@/components/WorkoutPreferences';
import { cancelNativeRestAlert, scheduleNativeRestAlert } from '@/utils/nativeRestNotifications';
import { showRestNotification } from '@/utils/restNotifications';

const mocks = vi.hoisted(() => ({ data: {} as unknown, toast: vi.fn() }));
vi.mock('./AppDataProvider', () => ({ useAppData: () => mocks.data }));
vi.mock('./ToastProvider', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@/utils/nativeRestNotifications', () => ({
  nativeRestNotificationsSupported: () => true,
  scheduleNativeRestAlert: vi.fn().mockResolvedValue(true),
  cancelNativeRestAlert: vi.fn().mockResolvedValue(true),
  listenForNativeRestNotification: () => () => {},
  exactRestAlarmsAllowed: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/utils/restNotifications', () => ({
  notificationsSupported: () => true,
  restNotificationPermission: vi.fn().mockResolvedValue('granted'),
  requestRestNotificationPermission: vi.fn().mockResolvedValue('granted'),
  showRestNotification: vi.fn().mockResolvedValue(true),
  closeRestNotifications: vi.fn().mockResolvedValue(undefined),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let rest: ReturnType<typeof useWorkoutAlerts>['rest'];
function View() {
  rest = useWorkoutAlerts().rest;
  return <WorkoutPreferences />;
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
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  root = createRoot(host);
  mocks.data = { settings: makeSettings({ notifyOnRestEnd: true, vibrateOnRestEnd: false }) };
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('schedules on start, reschedules when time is added, and cancels on stop or opt-out', async () => {
  await draw();
  await act(async () => rest.start(60));
  expect(scheduleNativeRestAlert).toHaveBeenLastCalledWith(Date.now() + 60_000, location.href);
  await act(async () => rest.add(30));
  expect(scheduleNativeRestAlert).toHaveBeenLastCalledWith(Date.now() + 90_000, location.href);
  await act(async () => rest.stop());
  expect(cancelNativeRestAlert).toHaveBeenCalled();
  await act(async () => rest.start(30));
  vi.mocked(cancelNativeRestAlert).mockClear();
  mocks.data = { settings: makeSettings({ notifyOnRestEnd: false }) };
  await draw();
  expect(cancelNativeRestAlert).toHaveBeenCalledTimes(1);
});

it('never emits a second notification on JS completion and supports adding time at zero', async () => {
  await draw();
  await act(async () => rest.start(1));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(showRestNotification).not.toHaveBeenCalled();
  expect(scheduleNativeRestAlert).toHaveBeenCalledTimes(1);
  await act(async () => rest.add(30));
  expect(scheduleNativeRestAlert).toHaveBeenLastCalledWith(Date.now() + 30_000, location.href);
});

it('renders an enabled APK toggle and Android permission help without browser APIs', async () => {
  expect(typeof Notification).toBe('undefined');
  await draw();
  expect((host.querySelector('#rest-notifications') as HTMLInputElement).disabled).toBe(false);
  expect(host.textContent).not.toContain('HTTPS address');
  expect(host.textContent).toContain('Allow precise rest alerts');
  expect(host.textContent).toContain('Test rest notification');
});
