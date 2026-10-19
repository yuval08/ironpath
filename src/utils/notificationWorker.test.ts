import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync(resolve('public/notification-events.js'), 'utf8');

async function click(url: string, existing = true) {
  const postMessage = vi.fn();
  const focus = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  let handler!: (event: unknown) => void;
  const self = {
    registration: { scope: 'https://example.test/ironpath/' },
    clients: {
      matchAll: vi
        .fn()
        .mockResolvedValue(
          existing ? [{ url: 'https://example.test/ironpath/#/more', postMessage, focus }] : [],
        ),
      openWindow,
    },
    addEventListener: (_name: string, callback: typeof handler) => {
      handler = callback;
    },
  };
  runInNewContext(source, { self, URL });
  let done!: Promise<void>;
  const close = vi.fn();
  handler({
    notification: { tag: 'ironpath-rest-finished', data: { url }, close },
    waitUntil: (promise: Promise<void>) => {
      done = promise;
    },
  });
  await done;
  return { postMessage, focus, openWindow, close };
}

it('focuses the existing app and sends a route message without reloading workout state', async () => {
  const url = 'https://example.test/ironpath/#/workout/session_1';
  const result = await click(url);
  expect(result.close).toHaveBeenCalled();
  expect(result.postMessage).toHaveBeenCalledWith({ type: 'IRONPATH_REST_NOTIFICATION', url });
  expect(result.focus).toHaveBeenCalled();
  expect(result.openWindow).not.toHaveBeenCalled();
});

it('opens the workout when no app window exists and restricts targets to the app scope', async () => {
  const url = 'https://example.test/ironpath/#/workout/session_1';
  expect((await click(url, false)).openWindow).toHaveBeenCalledWith(url);
  expect((await click('https://other.example/phishing', false)).openWindow).toHaveBeenCalledWith(
    'https://example.test/ironpath/#/workout',
  );
});
