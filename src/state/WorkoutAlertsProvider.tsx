import { createContext, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useRestTimer } from '@/hooks/useTimers';
import type { RestTimer } from '@/hooks/useTimers';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import type { ScreenWakeStatus } from '@/hooks/useScreenWakeLock';
import {
  nativeRestNotificationsSupported,
  scheduleNativeRestAlert,
  cancelNativeRestAlert,
  listenForNativeRestNotification,
} from '@/utils/nativeRestNotifications';
import { closeRestNotifications, showRestNotification } from '@/utils/restNotifications';
import { useAppData } from './AppDataProvider';
import { useToast } from './ToastProvider';

const AlertsContext = createContext<{ rest: RestTimer; wakeStatus: ScreenWakeStatus } | null>(null);

/** Lives above routing, so viewing History or Settings never cancels an active rest. */
export function WorkoutAlertsProvider({ children }: { children: ReactNode }) {
  const { settings } = useAppData();
  const { toast } = useToast();
  const workoutUrl = useRef('');
  const deadline = useRef<number | null>(null);
  useEffect(() => listenForNativeRestNotification(), []);
  const syncNativeAlert = () => {
    if (!nativeRestNotificationsSupported()) return;
    if (!settings?.notifyOnRestEnd || deadline.current == null || deadline.current <= Date.now()) {
      void cancelNativeRestAlert();
    } else {
      void scheduleNativeRestAlert(deadline.current, workoutUrl.current).then((scheduled) => {
        if (!scheduled)
          toast('Could not schedule the rest alert. Check notification permissions in Settings.');
      });
    }
  };
  useEffect(() => {
    if (settings) syncNativeAlert();
    // A setting change must cancel/reschedule an existing Android alarm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.notifyOnRestEnd]);
  const wakeStatus = useScreenWakeLock(settings?.keepScreenOn ?? false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onNotification = (event: MessageEvent) => {
      if (event.data?.type !== 'IRONPATH_REST_NOTIFICATION' || typeof event.data.url !== 'string')
        return;
      try {
        const target = new URL(event.data.url);
        const app = new URL(import.meta.env.BASE_URL, location.href);
        if (
          target.origin === app.origin &&
          target.pathname === app.pathname &&
          /^#\/workout(?:\/[^/?#]+)?$/.test(target.hash)
        ) {
          window.location.hash = target.hash;
        }
      } catch {
        /* Ignore invalid notification payloads. */
      }
    };
    navigator.serviceWorker.addEventListener('message', onNotification);
    return () => navigator.serviceWorker.removeEventListener('message', onNotification);
  }, []);
  const timer = useRestTimer({
    vibrate: settings?.vibrateOnRestEnd ?? true,
    sound: settings?.soundOnRestEnd ?? false,
    onComplete: () => {
      toast('Rest complete — ready for your next set.');
      if (
        !nativeRestNotificationsSupported() &&
        settings?.notifyOnRestEnd &&
        (document.visibilityState !== 'visible' || !document.hasFocus())
      ) {
        void showRestNotification(workoutUrl.current);
      }
    },
  });
  const rest: RestTimer = {
    ...timer,
    start: (seconds) => {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      deadline.current = Date.now() + seconds * 1000;
      workoutUrl.current = window.location.href;
      void closeRestNotifications();
      timer.start(seconds);
      syncNativeAlert();
    },
    add: (seconds) => {
      if (!Number.isFinite(seconds) || deadline.current == null) return;
      deadline.current += seconds * 1000;
      timer.add(seconds);
      syncNativeAlert();
    },
    stop: () => {
      deadline.current = null;
      void closeRestNotifications();
      timer.stop();
    },
  };
  return <AlertsContext.Provider value={{ rest, wakeStatus }}>{children}</AlertsContext.Provider>;
}

export function useWorkoutAlerts() {
  const alerts = useContext(AlertsContext);
  if (!alerts) throw new Error('Workout alerts provider is missing');
  return alerts;
}
