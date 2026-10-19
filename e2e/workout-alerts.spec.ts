import { expect, test } from '@playwright/test';

test('keeps the screen awake and sends a background rest notification across app navigation', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['notifications']);
  await page.addInitScript(() => {
    const metrics = { requests: 0, releases: 0 };
    Object.assign(window, { wakeMetrics: metrics });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          metrics.requests += 1;
          const lock = Object.assign(new EventTarget(), {
            released: false,
            release: async () => {
              lock.released = true;
              metrics.releases += 1;
              lock.dispatchEvent(new Event('release'));
            },
          });
          return lock;
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();
  await page.getByRole('link', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /Settings & Backup/ }).click();
  await page.getByLabel('Keep screen on while using the app').click();
  await expect(page.getByLabel('Keep screen on while using the app')).toBeChecked();
  await expect(page.getByText('Screen staying on.', { exact: false })).toBeVisible();
  await page.getByLabel('Notify me when rest ends outside the app').click();
  await expect(page.getByLabel('Notify me when rest ends outside the app')).toBeChecked();
  await page.reload();
  await expect(page.getByLabel('Keep screen on while using the app')).toBeChecked();
  await expect(page.getByLabel('Notify me when rest ends outside the app')).toBeChecked();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: /Start today's workout/i }).click();
  await page.getByRole('button', { name: /^Start workout$/ }).click();
  await page
    .getByRole('dialog', { name: 'Pain before training' })
    .getByRole('button', { name: 'Save' })
    .click();
  const workoutUrl = page.url();
  await page.clock.install();
  await page.getByRole('button', { name: 'Rest 60s', exact: true }).click();
  await page.getByRole('button', { name: '45s', exact: true }).click();
  // Hash navigation also covers the browser Back/Forward path under the rest overlay.
  await page.evaluate(() => {
    location.hash = '#/more';
  });
  // Emulate focus/visibility because the headless browser has no phone lock screen.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(46_000);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return (await registration.getNotifications({ tag: 'ironpath-rest-finished' })).map(
          (n) => n.title,
        );
      }),
    )
    .toEqual(['Rest complete']);
  const data = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.getNotifications({ tag: 'ironpath-rest-finished' }))[0]?.data;
  });
  expect(data.url).toBe(workoutUrl);
  await page.evaluate((url) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    // Exercise the worker-to-app click message without a disruptive page reload.
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'IRONPATH_REST_NOTIFICATION', url },
      }),
    );
  }, workoutUrl);
  await expect(page).toHaveURL(workoutUrl);
  await expect(page.getByRole('button', { name: /^Finish/ }).first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { wakeMetrics: { requests: number } }).wakeMetrics.requests,
      ),
    )
    .toBe(2);
});
