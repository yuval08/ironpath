import { useEffect, useState } from 'react';

export type ScreenWakeStatus = 'off' | 'active' | 'inactive' | 'unavailable';

export function screenWakeSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.wakeLock?.request;
}

/** A browser releases screen locks on hide; reacquire when the app becomes visible. */
export function useScreenWakeLock(enabled: boolean): ScreenWakeStatus {
  const [status, setStatus] = useState<ScreenWakeStatus>('off');
  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }
    if (!screenWakeSupported()) {
      setStatus('unavailable');
      return;
    }
    let disposed = false;
    let pending = false;
    let lock: WakeLockSentinel | null = null;
    const release = () => {
      const held = lock;
      lock = null;
      if (held && !held.released) void held.release().catch(() => {});
    };
    const acquire = async () => {
      if (disposed || pending || lock || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const acquired = await navigator.wakeLock.request('screen');
        if (disposed || document.visibilityState !== 'visible') {
          await acquired.release();
          return;
        }
        lock = acquired;
        setStatus('active');
        acquired.addEventListener('release', () => {
          if (lock === acquired) {
            lock = null;
            if (!disposed) setStatus('inactive');
          }
        });
      } catch {
        if (!disposed) setStatus('inactive');
      } finally {
        pending = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
      else {
        release();
        setStatus('inactive');
      }
    };
    setStatus('inactive');
    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', acquire);
    return () => {
      disposed = true;
      release();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', acquire);
    };
  }, [enabled]);
  return status;
}
