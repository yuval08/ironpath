import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRestTimer } from '@/hooks/useTimers';
import type { RestSource, RestTimer } from '@/hooks/useTimers';
import { nextUpLine } from '@/utils/nextUp';
import type { NextUp } from '@/utils/nextUp';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import type { ScreenWakeStatus } from '@/hooks/useScreenWakeLock';
import {
  nativeRestNotificationsSupported,
  scheduleNativeRestAlert,
  cancelNativeRestAlert,
  listenForNativeRestNotification,
} from '@/utils/nativeRestNotifications';
import { closeRestNotifications, showRestNotification } from '@/utils/restNotifications';
import { RestCoordinator, restCoordinatorSupported } from '@/watch/restCoordinator';
import type { RestView } from '@/watch/restCoordinator';
import { recordJsDiagnostic } from '@/watch/diagnostics';
import { db } from '@/db/db';
import { useAppData } from './AppDataProvider';
import { useToast } from './ToastProvider';

export interface RestContext {
  sessionId: string;
  /** Mutation that started this rest; an undo of it cancels the rest. */
  sourceOp?: string;
}

/** The rest timer, which also knows what comes next so alerts can say it. */
export interface WorkoutRest extends RestTimer {
  start: (seconds: number, next?: NextUp | null, ctx?: RestContext) => void;
  /** Where the end-of-rest alert goes; null without a coordinated rest. */
  destination: 'watch' | 'phone' | 'both' | 'none' | null;
  /** Who started the shared rest; null without a coordinated rest. */
  origin: 'phone' | 'watch' | null;
  /** Mutation that started the current rest; null for presets or no rest. */
  sourceOp: string | null;
}

const AlertsContext = createContext<{ rest: WorkoutRest; wakeStatus: ScreenWakeStatus } | null>(
  null,
);

export const REST_MIGRATION_KEY = 'rest:migratedToCoordinator';

function completionToast(next: { title: string; detail: string } | null): string {
  return next
    ? `Rest complete — ${next.title}, ${next.detail}.`
    : 'Rest complete — ready for your next set.';
}

/**
 * Lives above routing, so viewing History or Settings never cancels an active rest.
 * On Android with the RestCoordinator plugin, the native coordinator owns the one
 * shared timer and every alert (§3.2); JS only mirrors it and toasts.
 */
export function WorkoutAlertsProvider({ children }: { children: ReactNode }) {
  const { settings } = useAppData();
  const { toast } = useToast();
  const workoutUrl = useRef('');
  const deadline = useRef<number | null>(null);
  const next = useRef<NextUp | null>(null);
  const localSource = useRef<string | null>(null);
  const coordinated = restCoordinatorSupported();
  const [view, setView] = useState<RestView | null>(null);
  const seenRunning = useRef(new Set<string>());
  useEffect(() => listenForNativeRestNotification(), []);

  useEffect(() => {
    if (!coordinated) return undefined;
    let disposed = false;
    const accept = (value: RestView) => {
      if (!disposed) setView(value);
    };
    const handles = [
      RestCoordinator.addListener('restChanged', accept),
      RestCoordinator.addListener('restAlertTapped', () => {
        window.location.hash = '#/workout';
      }),
    ];
    void RestCoordinator.getState().then(accept, () => {});
    // 1.0.5 scheduled rest alarms through LocalNotifications; clear them once.
    void db
      .transaction('rw', db.meta, async () => {
        if (await db.meta.get(REST_MIGRATION_KEY)) return false;
        await db.meta.put({ key: REST_MIGRATION_KEY, value: true });
        return true;
      })
      .then((claimed) => (claimed ? cancelNativeRestAlert() : false))
      .catch(() => {});
    return () => {
      disposed = true;
      for (const handle of handles) void handle.then((h) => h.remove()).catch(() => {});
    };
  }, [coordinated]);

  const notify = settings?.notifyOnRestEnd;
  const vibrate = settings?.vibrateOnRestEnd;
  useEffect(() => {
    // Suspended JS cannot be asked, so the coordinator keeps its own copy.
    if (!coordinated || notify === undefined || vibrate === undefined) return;
    void RestCoordinator.configure({ notify, vibrate }).catch(() => {});
  }, [coordinated, notify, vibrate]);

  const syncNativeAlert = () => {
    if (coordinated || !nativeRestNotificationsSupported()) return;
    if (!settings?.notifyOnRestEnd || deadline.current == null || deadline.current <= Date.now()) {
      void cancelNativeRestAlert();
    } else {
      void scheduleNativeRestAlert(
        deadline.current,
        workoutUrl.current,
        undefined,
        nextUpLine(next.current) ?? undefined,
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

  const shared = coordinated ? (view?.timer ?? null) : null;
  if (shared?.state === 'running') seenRunning.current.add(shared.timerId);
  // An 'ended' rest counts down to zero once, but only if this app saw it running.
  const counting =
    shared &&
    (shared.state === 'running' ||
      (shared.state === 'ended' && seenRunning.current.has(shared.timerId)));
  const source: RestSource | undefined = coordinated
    ? {
        endsAt: counting ? view!.measuredAtWall + shared.remainingMs : null,
        total: Math.round((shared?.durationMs ?? 0) / 1000),
        key: shared?.timerId ?? null,
      }
    : undefined;
  const destination = shared?.alert.destination ?? null;

  const timer = useRestTimer({
    // The coordinator alerts natively; vibrate here only when it will not.
    vibrate: coordinated
      ? (settings?.vibrateOnRestEnd ?? true) &&
        shared?.alert.phoneBackup === 'off' &&
        destination !== 'watch'
      : (settings?.vibrateOnRestEnd ?? true),
    sound: (settings?.soundOnRestEnd ?? false) && destination !== 'watch',
    source,
    onComplete: () => {
      if (coordinated) {
        const label = shared?.next ?? null;
        toast(completionToast(label && { title: label.title, detail: label.text }));
        if (shared && source?.endsAt != null)
          void recordJsDiagnostic('js.restComplete', {
            timerId: shared.timerId,
            data: { delayMs: Math.max(0, Date.now() - source.endsAt) },
          });
        return;
      }
      toast(completionToast(next.current));
      if (
        !nativeRestNotificationsSupported() &&
        settings?.notifyOnRestEnd &&
        (document.visibilityState !== 'visible' || !document.hasFocus())
      ) {
        void showRestNotification(workoutUrl.current, nextUpLine(next.current) ?? undefined);
      }
    },
  });
  const running = shared?.state === 'running' ? shared : null;
  // An ended rest still accepts added time ("add at zero" restarts it natively).
  const adjustable = running ?? (shared?.state === 'ended' ? shared : null);
  const failed = () => toast('Could not update the rest timer. Please try again.');
  const rest: WorkoutRest = {
    ...timer,
    destination,
    origin: shared?.origin ?? null,
    sourceOp: coordinated
      ? (shared?.sourceOp ?? null)
      : timer.remaining != null
        ? localSource.current
        : null,
    start: (seconds, upcoming, ctx) => {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      // Restarting from a preset keeps what was already known to come next.
      if (upcoming !== undefined) next.current = upcoming;
      workoutUrl.current = window.location.href;
      void closeRestNotifications();
      if (coordinated) {
        const label = next.current;
        void RestCoordinator.start({
          sessionId: ctx?.sessionId ?? null,
          durationSeconds: Math.min(86_400, Math.max(1, Math.round(seconds))),
          sourceOp: ctx?.sourceOp ?? null,
          next: label ? { title: label.title, text: label.detail } : null,
        }).then(setView, failed);
        return;
      }
      deadline.current = Date.now() + seconds * 1000;
      localSource.current = ctx?.sourceOp ?? null;
      timer.start(seconds);
      syncNativeAlert();
    },
    add: (seconds) => {
      if (!Number.isFinite(seconds)) return;
      if (coordinated) {
        const deltaSeconds = Math.max(-3600, Math.min(3600, Math.round(seconds)));
        if (adjustable && deltaSeconds !== 0)
          void RestCoordinator.adjust({ timerId: adjustable.timerId, deltaSeconds }).then(
            setView,
            failed,
          );
        return;
      }
      if (deadline.current == null) return;
      deadline.current = Math.max(Date.now(), deadline.current + seconds * 1000);
      timer.add(seconds);
      syncNativeAlert();
    },
    stop: () => {
      next.current = null;
      void closeRestNotifications();
      if (coordinated) {
        if (running) void RestCoordinator.skip({ timerId: running.timerId }).then(setView, failed);
        return;
      }
      deadline.current = null;
      localSource.current = null;
      void cancelNativeRestAlert();
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
