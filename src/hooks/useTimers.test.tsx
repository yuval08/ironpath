import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRestTimer } from './useTimers';
import type { RestTimer } from './useTimers';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let timer: RestTimer;
let complete: ReturnType<typeof vi.fn>;
function Timer({ sound = false }: { sound?: boolean }) {
  timer = useRestTimer({ vibrate: false, sound, onComplete: complete });
  return null;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  complete = vi.fn();
  root = createRoot(document.createElement('div'));
  act(() => root.render(<Timer />));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('rest deadline and alert lifecycle', () => {
  it('finishes immediately on resume after timers were suspended, only once', () => {
    act(() => timer.start(60));
    vi.setSystemTime(Date.now() + 90_000);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(timer.remaining).toBe(0);
    expect(complete).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new Event('focus')));
    act(() => root.render(<Timer sound />));
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('extends the deadline, cancels without an alert, and ignores invalid durations', () => {
    act(() => timer.start(10));
    act(() => vi.advanceTimersByTime(9_000));
    act(() => timer.add(10));
    act(() => vi.advanceTimersByTime(2_000));
    expect(timer.remaining).toBe(9);
    expect(complete).not.toHaveBeenCalled();
    act(() => timer.stop());
    act(() => vi.advanceTimersByTime(20_000));
    expect(complete).not.toHaveBeenCalled();
    act(() => timer.start(Number.NaN));
    expect(timer.remaining).toBeNull();
  });

  it('does not let an old dismissal cancel a newly started rest', () => {
    act(() => timer.start(1));
    act(() => vi.advanceTimersByTime(1_000));
    expect(complete).toHaveBeenCalledTimes(1);
    act(() => timer.start(60));
    act(() => vi.advanceTimersByTime(1_000));
    expect(timer.remaining).toBe(59);
    act(() => vi.advanceTimersByTime(59_000));
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
