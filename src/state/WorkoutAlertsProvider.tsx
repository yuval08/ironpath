import { createContext, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useRestTimer } from '@/hooks/useTimers';
import type { RestTimer } from '@/hooks/useTimers';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import type { ScreenWakeStatus } from '@/hooks/useScreenWakeLock';
import { closeRestNotifications, showRestNotification } from '@/utils/restNotifications';
import { useAppData } from './AppDataProvider';
import { useToast } from './ToastProvider';

const AlertsContext = createContext<{ rest: RestTimer; wakeStatus: ScreenWakeStatus } | null>(null);

/** Lives above routing, so viewing History or Settings never cancels an active rest. */
export function WorkoutAlertsProvider({ children }: { children: ReactNode }) {
  const { settings } = useAppData();
  const { toast } = useToast();
  const workoutUrl = useRef('');
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
      workoutUrl.current = window.location.href;
      void closeRestNotifications();
      timer.start(seconds);
    },
    stop: () => {
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
