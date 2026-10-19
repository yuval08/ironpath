const REST_TAG = 'ironpath-rest-finished';
let generation = 0;

export function notificationsSupported(): boolean {
  return (
    typeof Notification !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator
  );
}

/** Call directly from a user gesture; permission is never requested by a timer. */
export async function requestRestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  return Notification.requestPermission();
}

export async function showRestNotification(url: string): Promise<boolean> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  try {
    const current = generation;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active || current !== generation) return false;
    await registration.showNotification('Rest complete', {
      body: 'Ready for your next set? Tap to return to your workout.',
      tag: REST_TAG,
      icon: new URL(`${import.meta.env.BASE_URL}icons/icon-192.png`, location.href).href,
      data: { url },
    });
    return true;
  } catch {
    return false;
  }
}

export async function closeRestNotifications(): Promise<void> {
  generation += 1;
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const notifications = await registration?.getNotifications({ tag: REST_TAG });
    notifications?.forEach((notification) => notification.close());
  } catch {
    // Permission can be revoked or the worker removed while a workout is open.
  }
}
