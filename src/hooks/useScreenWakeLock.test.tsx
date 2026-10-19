import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenWakeLock } from './useScreenWakeLock';
import type { ScreenWakeStatus } from './useScreenWakeLock';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let status: ScreenWakeStatus;
function Screen({ enabled }: { enabled: boolean }) {
  status = useScreenWakeLock(enabled);
  return null;
}
function sentinel() {
  return Object.assign(new EventTarget(), {
    released: false,
    release: vi.fn().mockResolvedValue(undefined),
  });
}
beforeEach(() => {
  root = createRoot(document.createElement('div'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'wakeLock');
});

describe('screen wake lock', () => {
  it('releases on hide, reacquires on return, and releases when disabled', async () => {
    const first = sentinel();
    const second = sentinel();
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    await act(async () => root.render(<Screen enabled />));
    expect(status).toBe('active');
    expect(request).toHaveBeenCalledWith('screen');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(first.release).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => root.render(<Screen enabled={false} />));
    expect(second.release).toHaveBeenCalledTimes(1);
    expect(status).toBe('off');
  });

  it('releases a request that resolves after the setting was disabled', async () => {
    const lock = sentinel();
    let resolve!: (value: typeof lock) => void;
    const pending = new Promise<typeof lock>((done) => {
      resolve = done;
    });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: () => pending },
    });
    await act(async () => root.render(<Screen enabled />));
    await act(async () => root.render(<Screen enabled={false} />));
    await act(async () => resolve(lock));
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(status).toBe('off');
  });

  it('handles unsupported browsers and power-saving rejection', async () => {
    await act(async () => root.render(<Screen enabled />));
    expect(status).toBe('unavailable');
    await act(async () => root.render(<Screen enabled={false} />));
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: vi.fn().mockRejectedValue(new Error('Low power')) },
    });
    await act(async () => root.render(<Screen enabled />));
    expect(status).toBe('inactive');
  });
});
