import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  cancelNativeRestAlert,
  exactRestAlarmsAllowed,
  listenForNativeRestNotification,
  nativeRestPermission,
  scheduleNativeRestAlert,
  scheduleNativeRestTestAlert,
} from './nativeRestNotifications';
import {
  notificationsSupported,
  requestRestNotificationPermission,
  restNotificationPermission,
} from './restNotifications';

const native = vi.hoisted(() => ({ enabled: true }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.enabled,
    isPluginAvailable: () => true,
    getPlatform: () => 'android',
  },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    checkExactNotificationSetting: vi.fn(),
    changeExactNotificationSetting: vi.fn(),
    createChannel: vi.fn(),
    schedule: vi.fn(),
    cancel: vi.fn(),
    removeDeliveredNotificationsById: vi.fn(),
    addListener: vi.fn(),
  },
}));

beforeEach(() => {
  native.enabled = true;
  vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' });
  vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' });
  vi.mocked(LocalNotifications.checkExactNotificationSetting).mockResolvedValue({
    exact_alarm: 'granted',
  });
  vi.mocked(LocalNotifications.changeExactNotificationSetting).mockResolvedValue({
    exact_alarm: 'granted',
  });
  vi.mocked(LocalNotifications.schedule).mockResolvedValue({ notifications: [] });
});
afterEach(async () => {
  await cancelNativeRestAlert();
  vi.resetAllMocks();
});

describe('Android rest alerts', () => {
  it('supports the APK without a browser Notification or service worker and prompts only explicitly', async () => {
    expect(notificationsSupported()).toBe(true);
    expect(await restNotificationPermission()).toBe('granted');
    expect(LocalNotifications.requestPermissions).not.toHaveBeenCalled();
    expect(await requestRestNotificationPermission()).toBe('granted');
    expect(LocalNotifications.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('schedules a native deadline with exact permission and a workout target', async () => {
    const deadline = Date.now() + 90_000;
    expect(await scheduleNativeRestAlert(deadline, 'http://localhost/#/workout/s1')).toBe(true);
    expect(LocalNotifications.schedule).toHaveBeenCalledWith({
      notifications: [
        expect.objectContaining({
          id: 71001,
          schedule: { at: new Date(deadline), allowWhileIdle: true },
          isExactNotification: true,
          extra: { url: 'http://localhost/#/workout/s1' },
        }),
      ],
    });
    expect(LocalNotifications.requestPermissions).not.toHaveBeenCalled();
    expect(LocalNotifications.changeExactNotificationSetting).not.toHaveBeenCalled();
  });

  it('uses inexact fallback without opening settings from a timer', async () => {
    vi.mocked(LocalNotifications.checkExactNotificationSetting).mockResolvedValue({
      exact_alarm: 'denied',
    });
    expect(await scheduleNativeRestAlert(Date.now() + 10_000, 'http://localhost/#/workout')).toBe(
      true,
    );
    expect(LocalNotifications.schedule).toHaveBeenCalledWith({
      notifications: [expect.objectContaining({ isExactNotification: false })],
    });
    expect(LocalNotifications.changeExactNotificationSetting).not.toHaveBeenCalled();
    expect(await exactRestAlarmsAllowed(true)).toBe(true);
    expect(LocalNotifications.changeExactNotificationSetting).toHaveBeenCalledTimes(1);
  });

  it('does not schedule or prompt when notification permission was revoked', async () => {
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'denied' });
    expect(await nativeRestPermission()).toBe('denied');
    expect(await scheduleNativeRestAlert(Date.now() + 60_000, 'http://localhost/#/workout')).toBe(
      false,
    );
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    expect(LocalNotifications.requestPermissions).not.toHaveBeenCalled();
  });

  it('finishes a late schedule before cancelling it, so stopping rest cannot leave a stale alarm', async () => {
    let resolve!: (value: { notifications: [] }) => void;
    vi.mocked(LocalNotifications.schedule).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = scheduleNativeRestAlert(Date.now() + 30_000, 'http://localhost/#/workout');
    await vi.waitFor(() => expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1));
    const stopped = cancelNativeRestAlert();
    resolve({ notifications: [] });
    await pending;
    await stopped;
    expect(LocalNotifications.cancel).toHaveBeenCalledTimes(2);
    expect(LocalNotifications.removeDeliveredNotificationsById).toHaveBeenLastCalledWith({
      ids: [71001, 71002],
    });
  });

  it('uses the latest deadline when a rest is extended, and tolerates scheduling failure', async () => {
    const first = Date.now() + 60_000;
    await Promise.all([
      scheduleNativeRestAlert(first, 'http://localhost/#/workout'),
      scheduleNativeRestAlert(first + 30_000, 'http://localhost/#/workout'),
    ]);
    expect(LocalNotifications.schedule).toHaveBeenLastCalledWith({
      notifications: [
        expect.objectContaining({
          schedule: { at: new Date(first + 30_000), allowWhileIdle: true },
        }),
      ],
    });
    vi.mocked(LocalNotifications.schedule).mockRejectedValueOnce(new Error('OS rejected'));
    expect(await scheduleNativeRestAlert(first, 'http://localhost/#/workout')).toBe(false);
    expect(await cancelNativeRestAlert()).toBe(true);
  });

  it('tests notifications without replacing an active rest alarm', async () => {
    await scheduleNativeRestAlert(Date.now() + 60_000, 'http://localhost/#/workout/s1');
    vi.mocked(LocalNotifications.cancel).mockClear();
    await scheduleNativeRestTestAlert('http://localhost/#/workout');
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 71002 }] });
    expect(LocalNotifications.schedule).toHaveBeenLastCalledWith({
      notifications: [expect.objectContaining({ id: 71002 })],
    });
  });

  it('validates tapped workout URLs and removes listeners during cleanup', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.mocked(LocalNotifications.addListener).mockResolvedValue({ remove });
    const stop = listenForNativeRestNotification();
    const callback = vi.mocked(LocalNotifications.addListener).mock.calls[0]![1] as (
      event: unknown,
    ) => void;
    const original = location.hash;
    callback({ notification: { id: 71001, extra: { url: 'https://evil.example/#/workout/x' } } });
    expect(location.hash).toBe(original);
    callback({
      notification: {
        id: 71001,
        extra: { url: `${location.origin}${location.pathname}#/workout/s1` },
      },
    });
    expect(location.hash).toBe('#/workout/s1');
    stop();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    location.hash = original;
  });
});
