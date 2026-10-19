import { useEffect, useState } from 'react';
import { updateSettings } from '@/db/repository';
import { screenWakeSupported } from '@/hooks/useScreenWakeLock';
import { useAppData } from '@/state/AppDataProvider';
import { useToast } from '@/state/ToastProvider';
import { useWorkoutAlerts } from '@/state/WorkoutAlertsProvider';
import {
  notificationsSupported,
  requestRestNotificationPermission,
  showRestNotification,
} from '@/utils/restNotifications';

export function WorkoutPreferences() {
  const { settings } = useAppData();
  const { wakeStatus } = useWorkoutAlerts();
  const { toast } = useToast();
  const supported = notificationsSupported();
  const [permission, setPermission] = useState(() => (supported ? Notification.permission : null));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => setPermission(notificationsSupported() ? Notification.permission : null);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  if (!settings) return null;

  const changeNotifications = async (enabled: boolean) => {
    setBusy(true);
    try {
      if (enabled) {
        const granted = await requestRestNotificationPermission();
        setPermission(granted);
        if (granted !== 'granted') {
          toast('Allow notifications in your browser or app settings to enable rest alerts.');
          return;
        }
      }
      await updateSettings({ notifyOnRestEnd: enabled });
    } catch {
      toast('Could not update rest notifications. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="switch">
        <label htmlFor="keep-screen-on">Keep screen on while using the app</label>
        <input
          id="keep-screen-on"
          type="checkbox"
          checked={settings.keepScreenOn ?? false}
          disabled={!screenWakeSupported() && !settings.keepScreenOn}
          onChange={(event) =>
            void updateSettings({ keepScreenOn: event.target.checked }).catch(() =>
              toast('Could not update the screen setting. Please try again.'),
            )
          }
        />
      </div>
      <p className="muted tiny">
        {!screenWakeSupported()
          ? 'Keeping the screen on is unavailable in this browser.'
          : wakeStatus === 'active'
            ? 'Screen staying on. Switching apps releases the screen lock.'
            : settings.keepScreenOn
              ? 'Screen lock is not active. Your device may limit it in power-saving mode.'
              : 'Prevents dimming or automatic screen lock while Ironpath is visible.'}
      </p>
      <div className="switch">
        <label htmlFor="rest-notifications">Notify me when rest ends outside the app</label>
        <input
          id="rest-notifications"
          type="checkbox"
          checked={settings.notifyOnRestEnd ?? false}
          disabled={busy || (!supported && !settings.notifyOnRestEnd)}
          onChange={(event) => void changeNotifications(event.target.checked)}
        />
      </div>
      <p className="muted tiny">
        {!supported
          ? 'Notifications are unavailable here. Try installing the app from an HTTPS address.'
          : permission === 'denied'
            ? 'Notifications are blocked. Allow them in your browser or app settings.'
            : settings.notifyOnRestEnd && permission !== 'granted'
              ? 'Notification permission is needed. Turn this off and on to allow alerts.'
              : 'Allow notifications when prompted. Background alerts may be delayed if your phone suspends the app. Keep Ironpath open for the most reliable timing.'}
      </p>
      {supported && permission === 'granted' && (
        <button
          className="btn small"
          onClick={() =>
            void showRestNotification(
              new URL(`${import.meta.env.BASE_URL}#/workout`, location.href).href,
            ).then((sent) => {
              if (!sent)
                toast('Notifications are not ready. Reload the installed app and try again.');
            })
          }
        >
          Test rest notification
        </button>
      )}
    </>
  );
}
