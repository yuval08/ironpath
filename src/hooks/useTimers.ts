import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A wall-clock stopwatch that survives re-renders and tab backgrounding by
 * tracking timestamps rather than counting ticks.
 */
export function useStopwatch(initialSeconds = 0, autoStart = false) {
  const [elapsed, setElapsed] = useState(initialSeconds);
  const [running, setRunning] = useState(autoStart);
  const anchor = useRef<{ at: number; base: number } | null>(null);

  useEffect(() => {
    if (!running) return undefined;
    anchor.current = { at: Date.now(), base: elapsed };
    const id = window.setInterval(() => {
      const a = anchor.current;
      if (!a) return;
      setElapsed(a.base + Math.floor((Date.now() - a.at) / 1000));
    }, 500);
    return () => window.clearInterval(id);
    // `elapsed` is intentionally excluded — it is re-anchored on each start/stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const start = useCallback(() => setRunning(true), []);
  const pause = useCallback(() => setRunning(false), []);
  const toggle = useCallback(() => setRunning((r) => !r), []);
  const reset = useCallback((seconds = 0) => {
    setElapsed(seconds);
    anchor.current = { at: Date.now(), base: seconds };
  }, []);

  return { elapsed, running, start, pause, toggle, reset, setElapsed };
}

export interface RestTimer {
  remaining: number | null;
  total: number;
  start: (seconds: number) => void;
  stop: () => void;
  add: (seconds: number) => void;
}

export const REST_PRESETS = [45, 60, 75, 90];

/** Countdown against a deadline, checking immediately when a suspended page resumes. */
export function useRestTimer(
  options: {
    vibrate?: boolean;
    sound?: boolean;
    onComplete?: () => void;
  } = {},
): RestTimer {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [total, setTotal] = useState(60);
  const [remaining, setRemaining] = useState<number | null>(null);
  const notified = useRef(false);
  const dismissTimeout = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (endsAt == null) {
      setRemaining(null);
      return undefined;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0 && !notified.current) {
        notified.current = true;
        const { vibrate = true, sound = false, onComplete } = optionsRef.current;
        if (vibrate && typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([180, 90, 180]);
        }
        if (sound) playBeep();
        onComplete?.();
        // Held in a ref and cleared below: starting a new rest inside this
        // 900ms window would otherwise be cancelled by the previous one's
        // orphaned dismissal — exactly when the buzz says "go again".
        dismissTimeout.current = window.setTimeout(() => setEndsAt(null), 900);
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(dismissTimeout.current);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, [endsAt]);

  const start = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    notified.current = false;
    if (optionsRef.current.sound) prepareRestAudio();
    setTotal(seconds);
    setEndsAt(Date.now() + seconds * 1000);
  }, []);

  const stop = useCallback(() => setEndsAt(null), []);

  const add = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    notified.current = false;
    setEndsAt((current) => (current == null ? null : current + seconds * 1000));
    setTotal((t) => t + seconds);
  }, []);

  return { remaining, total, start, stop, add };
}

let restAudio: AudioContext | null = null;

/** Unlock audio during the set/rest button's user gesture, before the countdown expires. */
function prepareRestAudio(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!restAudio || restAudio.state === 'closed') restAudio = new Ctx();
    if (restAudio.state === 'suspended') void restAudio.resume().catch(() => {});
    return restAudio;
  } catch {
    return null;
  }
}

function playBeep(): void {
  try {
    const ctx = prepareRestAudio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    /* audio is best-effort only */
  }
}
