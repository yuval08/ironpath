import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSettings } from '@/test/factories';
import { WorkoutAlertsProvider, useWorkoutAlerts } from './WorkoutAlertsProvider';
import { showRestNotification } from '@/utils/restNotifications';
import { WorkoutPreferences } from '@/components/WorkoutPreferences';
import { updateSettings } from '@/db/repository';

const mocks = vi.hoisted(() => ({ data: {} as unknown, toast: vi.fn() }));
vi.mock('./AppDataProvider', () => ({ useAppData: () => mocks.data }));
vi.mock('./ToastProvider', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/db/repository', () => ({ updateSettings: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/utils/restNotifications', async (original) => ({
  ...(await original<typeof import('@/utils/restNotifications')>()),
  showRestNotification: vi.fn().mockResolvedValue(true),
  closeRestNotifications: vi.fn().mockResolvedValue(undefined),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let rest: ReturnType<typeof useWorkoutAlerts>['rest'];
let host: HTMLDivElement;
function Workout() {
  rest = useWorkoutAlerts().rest;
  return null;
}
async function draw(workout = true, preferences = false) {
  await act(async () =>
    root.render(
      <StrictMode>
        <WorkoutAlertsProvider>
          {workout && <Workout />}
          {preferences && <WorkoutPreferences />}
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
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('app-wide workout alerts', () => {
  it('survives leaving the workout screen and alerts once when unfocused', async () => {
    await draw();
    act(() => rest.start(10));
    await draw(false);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(showRestNotification).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith('Rest complete — ready for your next set.');
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(showRestNotification).toHaveBeenCalledTimes(1);
  });

  it('keeps foreground completion in-app and respects opt-out in the background', async () => {
    await draw();
    act(() => rest.start(1));
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(showRestNotification).not.toHaveBeenCalled();
    mocks.data = { settings: makeSettings({ notifyOnRestEnd: false, vibrateOnRestEnd: false }) };
    await draw();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    act(() => rest.start(1));
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(showRestNotification).not.toHaveBeenCalled();
  });

  it('asks permission only on explicit enable and never persists a denied opt-in', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: new EventTarget(),
    });
    mocks.data = { settings: makeSettings() };
    await draw(false, true);
    expect(requestPermission).not.toHaveBeenCalled();
    const checkbox = host.querySelector('#rest-notifications') as HTMLInputElement;
    await act(async () => checkbox.click());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(updateSettings).not.toHaveBeenCalled();
    requestPermission.mockResolvedValue('granted');
    await act(async () => checkbox.click());
    expect(updateSettings).toHaveBeenCalledWith({ notifyOnRestEnd: true });
  });
});
