import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const REST_ID = 71001;
const TEST_ID = 71002;
const CHANNEL_ID = 'ironpath-rest';
let queue: Promise<unknown> = Promise.resolve();
const DEFAULT_BODY = 'Ready for your next set? Tap to return to your workout.';
// On Android with the RestCoordinator plugin the rest alert and lock-screen countdown
// are native (PhoneRestAlerts); this LocalNotifications path serves other platforms
// and the test alert.

export function nativeRestNotificationsSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications');
}

export async function nativeRestPermission(request = false): Promise<NotificationPermission> {
  const result = request
    ? await LocalNotifications.requestPermissions()
    : await LocalNotifications.checkPermissions();
  return result.display === 'granted'
    ? 'granted'
    : result.display === 'denied'
      ? 'denied'
      : 'default';
}

export async function exactRestAlarmsAllowed(request = false): Promise<boolean | null> {
  if (!nativeRestNotificationsSupported() || Capacitor.getPlatform() !== 'android') return null;
  try {
    const result = request
      ? await LocalNotifications.changeExactNotificationSetting()
      : await LocalNotifications.checkExactNotificationSetting();
    return result.exact_alarm === 'granted';
  } catch {
    return false;
  }
}

/** Serialize replacement/cancellation so an older async request cannot win a race. */
function enqueue(operation: () => Promise<boolean>): Promise<boolean> {
  const next = queue.then(operation).catch(() => false);
  queue = next;
  return next;
}

async function clearRestAlert(ids = [REST_ID]): Promise<void> {
  await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  await LocalNotifications.removeDeliveredNotificationsById({ ids });
}

export function cancelNativeRestAlert(): Promise<boolean> {
  if (!nativeRestNotificationsSupported()) return Promise.resolve(false);
  return enqueue(async () => {
    await clearRestAlert([REST_ID, TEST_ID]);
    return true;
  });
}

/** Schedule while the app is running; Android owns delivery after JS is suspended. */
export function scheduleNativeRestTestAlert(url: string): Promise<boolean> {
  return scheduleNativeRestAlert(Date.now() + 3000, url, TEST_ID);
}

export function scheduleNativeRestAlert(
  deadline: number,
  url: string,
  id = REST_ID,
  body = DEFAULT_BODY,
): Promise<boolean> {
  if (!nativeRestNotificationsSupported() || !Number.isFinite(deadline))
    return Promise.resolve(false);
  return enqueue(async () => {
    await clearRestAlert([id]);
    // Never let schedule() trigger a permission/settings prompt from a timer.
    if (deadline <= Date.now() || (await nativeRestPermission()) !== 'granted') return false;
    const exact = await exactRestAlarmsAllowed();
    if (Capacitor.getPlatform() === 'android') {
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: 'Rest timer',
        description: 'Alerts when your workout rest ends',
        importance: 4,
        vibration: true,
        visibility: 1,
      });
    }
    if (deadline <= Date.now()) return false;
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title: 'Rest complete',
          body,
          channelId: CHANNEL_ID,
          smallIcon: 'ic_stat_rest',
          iconColor: '#0f766e',
          schedule: { at: new Date(deadline), allowWhileIdle: true },
          isExactNotification: exact === true,
          autoCancel: true,
          extra: { url },
        },
      ],
    });
    return true;
  });
}

export function listenForNativeRestNotification(): () => void {
  if (!nativeRestNotificationsSupported()) return () => {};
  const listener = LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    if (event.notification.id !== REST_ID && event.notification.id !== TEST_ID) return;
    try {
      const target = new URL(event.notification.extra?.url);
      const app = new URL(import.meta.env.BASE_URL, location.href);
      if (
        target.origin === app.origin &&
        target.pathname === app.pathname &&
        /^#\/workout(?:\/[^/?#]+)?$/.test(target.hash)
      )
        window.location.hash = target.hash;
    } catch {
      /* Ignore invalid notification targets. */
    }
  }).catch(() => null);
  return () => {
    void listener.then((handle) => handle?.remove()).catch(() => {});
  };
}
