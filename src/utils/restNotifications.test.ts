import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeRestNotifications,
  requestRestNotificationPermission,
  showRestNotification,
} from './restNotifications';

const showNotification = vi.fn();
const getNotifications = vi.fn();
const requestPermission = vi.fn();
const getRegistration = vi.fn();
beforeEach(() => {
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration },
  });
  getRegistration.mockResolvedValue({ active: {}, showNotification, getNotifications });
  getNotifications.mockResolvedValue([]);
  showNotification.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('persistent rest notifications', () => {
  it('uses the service worker API required on mobile and includes a workout target', async () => {
    expect(await showRestNotification('http://localhost/#/workout/session_1')).toBe(true);
    expect(showNotification).toHaveBeenCalledWith(
      'Rest complete',
      expect.objectContaining({
        tag: 'ironpath-rest-finished',
        data: { url: 'http://localhost/#/workout/session_1' },
      }),
    );
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('never prompts automatically and handles revoked permissions or unavailable workers', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission });
    expect(await showRestNotification('http://localhost/')).toBe(false);
    expect(getRegistration).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    requestPermission.mockResolvedValue('denied');
    expect(await requestRestNotificationPermission()).toBe('denied');
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission });
    getRegistration.mockResolvedValue(undefined);
    expect(await showRestNotification('http://localhost/')).toBe(false);
    getRegistration.mockRejectedValue(new Error('Worker unavailable'));
    expect(await showRestNotification('http://localhost/')).toBe(false);
  });

  it('cancels an in-flight alert when a new rest starts or the user stops it', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    getRegistration.mockReturnValueOnce(pending);
    const showing = showRestNotification('http://localhost/');
    await closeRestNotifications();
    resolve({ active: {}, showNotification });
    expect(await showing).toBe(false);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('closes stale notifications and tolerates OS notification rejection', async () => {
    const close = vi.fn();
    getNotifications.mockResolvedValue([{ close }]);
    await closeRestNotifications();
    expect(close).toHaveBeenCalledTimes(1);
    showNotification.mockRejectedValue(new Error('Permission revoked'));
    expect(await showRestNotification('http://localhost/')).toBe(false);
  });
});
