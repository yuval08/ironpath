import { createContext, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useRestTimer } from '@/hooks/useTimers';
import type { RestTimer } from '@/hooks/useTimers';
import { nextUpLine } from '@/utils/nextUp';
import type { NextUp } from '@/utils/nextUp';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import type { ScreenWakeStatus } from '@/hooks/useScreenWakeLock';
import {
  nativeRestNotificationsSupported,
  scheduleNativeRestAlert,
  cancelNativeRestAlert,
  clearNativeRestLive,
  listenForNativeRestNotification,
  showNativeRestLive,
} from '@/utils/nativeRestNotifications';
import { closeRestNotifications, showRestNotification } from '@/utils/restNotifications';
import { useAppData } from './AppDataProvider';
import { useToast } from './ToastProvider';

/** The rest timer, which also knows what comes next so alerts can say it. */
export interface WorkoutRest extends RestTimer {
  start: (seconds: number, next?: NextUp | null) => void;
}

const AlertsContext = createContext<{ rest: WorkoutRest; wakeStatus: ScreenWakeStatus } | null>(
  null,
);

/** Lives above routing, so viewing History or Settings never cancels an active rest. */
export function WorkoutAlertsProvider({ children }: { children: ReactNode }) {
  const { settings } = useAppData();
  const { toast } = useToast();
  const workoutUrl = useRef('');
  const deadline = useRef<number | null>(null);
  const next = useRef<NextUp | null>(null);
  useEffect(() => listenForNativeRestNotification(), []);
  const syncNativeAlert = () => {
    if (!nativeRestNotificationsSupported()) return;
    if (!settings?.notifyOnRestEnd || deadline.current == null || deadline.current <= Date.now()) {
      void cancelNativeRestAlert();
      void clearNativeRestLive();
    } else {
      const upcoming = next.current;
      void showNativeRestLive(
        deadline.current,
        upcoming && {
          title: `Rest · ${upcoming.kind === 'set' ? 'next set' : 'next exercise'}: ${upcoming.title}`,
          text: upcoming.detail,
        },
      );
      void scheduleNativeRestAlert(
        deadline.current,
        workoutUrl.current,
        undefined,
        nextUpLine(upcoming) ?? undefined,
      ).then((scheduled) => {
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
      void clearNativeRestLive();
      const upcoming = next.current;
      toast(
        upcoming
          ? `Rest complete — ${upcoming.title}, ${upcoming.detail}.`
          : 'Rest complete — ready for your next set.',
      );
      if (
        !nativeRestNotificationsSupported() &&
        settings?.notifyOnRestEnd &&
        (document.visibilityState !== 'visible' || !document.hasFocus())
      ) {
        void showRestNotification(workoutUrl.current, nextUpLine(next.current) ?? undefined);
      }
    },
  });
  const rest: WorkoutRest = {
    ...timer,
    start: (seconds, upcoming) => {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      deadline.current = Date.now() + seconds * 1000;
      // Restarting from a preset keeps what was already known to come next.
      if (upcoming !== undefined) next.current = upcoming;
      workoutUrl.current = window.location.href;
      void closeRestNotifications();
      timer.start(seconds);
      syncNativeAlert();
    },
    add: (seconds) => {
      if (!Number.isFinite(seconds) || deadline.current == null) return;
      deadline.current = Math.max(Date.now(), deadline.current + seconds * 1000);
      timer.add(seconds);
      syncNativeAlert();
    },
    stop: () => {
      deadline.current = null;
      next.current = null;
      void closeRestNotifications();
      void clearNativeRestLive();
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
