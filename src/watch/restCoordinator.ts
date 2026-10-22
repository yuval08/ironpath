import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

/** Canonical phone rest timer, owned natively so it runs while the WebView sleeps (§3.2). */
export interface RestView {
  /** Phone Date.now() at measurement; same device, so safe for arithmetic. */
  measuredAtWall: number;
  timer: null | {
    timerId: string;
    revision: number;
    sessionId: string | null;
    state: 'running' | 'ended' | 'skipped' | 'cancelled' | 'replaced';
    remainingMs: number;
    durationMs: number;
    origin: 'phone' | 'watch';
    sourceOp: string | null;
    next: RestLabel | null;
    alert: {
      preferred: 'watch' | 'phone';
      destination: 'watch' | 'phone' | 'both' | 'none';
      watchArmedRevision: number | null;
      phoneBackup: 'scheduled' | 'suppressed' | 'off' | 'delivered';
    };
  };
}
export interface RestLabel {
  title: string;
  text: string;
}

export const RestCoordinator = registerPlugin<{
  getState(): Promise<RestView>;
  start(options: {
    sessionId: string | null;
    durationSeconds: number;
    sourceOp: string | null;
    next: RestLabel | null;
  }): Promise<RestView>;
  adjust(options: { timerId: string; deltaSeconds: number }): Promise<RestView>;
  skip(options: { timerId: string }): Promise<RestView>;
  /**
   * `reason: 'switch'` only cancels the session's running rest; any other reason
   * also closes the session so later rest ops for it are refused.
   */
  closeSession(options: { sessionId: string | null; reason?: RestCloseReason }): Promise<RestView>;
  configure(options: { notify: boolean; vibrate: boolean }): Promise<Record<string, never>>;
  addListener(
    event: 'restChanged',
    listener: (view: RestView) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: 'restAlertTapped', listener: () => void): Promise<PluginListenerHandle>;
}>('RestCoordinator');

export type RestCloseReason = 'finish' | 'removed' | 'restored' | 'switch';

export function restCoordinatorSupported(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('RestCoordinator');
}

/** Best effort: backup restore and finishing must not fail because of the timer. */
export async function closeCoordinatedRest(
  sessionId: string | null,
  reason: RestCloseReason,
): Promise<void> {
  if (!restCoordinatorSupported()) return;
  await RestCoordinator.closeSession({ sessionId, reason }).catch((error: unknown) =>
    console.warn('[rest] could not close the coordinated rest', error),
  );
}
