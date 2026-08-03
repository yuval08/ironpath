import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * End-to-end coverage for the five flows called out in the brief:
 * completing a workout, pausing the plan, restarting Week 1, exporting Excel
 * and restoring a JSON backup.
 */

async function freshApp(page: Page) {
  await page.goto('/');
  // Start every test from an empty database so runs are independent.
  await page.evaluate(async () => {
    await new Promise<void>((done) => {
      const req = indexedDB.deleteDatabase('movement-resilience');
      req.onsuccess = () => done();
      req.onerror = () => done();
      req.onblocked = () => done();
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();
}

async function completeWorkout(page: Page) {
  await page.getByRole('button', { name: /Start today's workout/i }).click();
  await expect(page.getByRole('heading', { name: 'Upper Body A' })).toBeVisible();

  // Warm-up is tracked separately from the session timer.
  await page.getByRole('button', { name: /Warm-up done/i }).click();

  // Pain-before sheet opens automatically.
  const painSheet = page.getByRole('dialog', { name: 'Pain before training' });
  await expect(painSheet).toBeVisible();
  await painSheet.getByRole('button', { name: 'Save' }).click();

  // Log every exercise via "Complete all".
  let guard = 0;
  while (guard < 40) {
    guard += 1;
    const button = page.getByRole('button', { name: 'Complete all' }).first();
    if (!(await button.isVisible().catch(() => false))) break;
    if (await button.isDisabled()) break;
    await button.click();
    const skipRest = page.getByRole('button', { name: 'Skip rest' });
    if (await skipRest.isVisible().catch(() => false)) await skipRest.click();
    const next = page.getByRole('button', { name: 'Next exercise' });
    if (await next.isVisible().catch(() => false)) await next.click();
    else break;
  }

  await page
    .getByRole('button', { name: /^Finish/ })
    .first()
    .click();
  const afterSheet = page.getByRole('dialog', { name: 'Pain after training' });
  await expect(afterSheet).toBeVisible();
  await afterSheet.getByRole('button', { name: /Save & complete workout/i }).click();
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
}

test.describe('Movement & Joint Resilience PWA', () => {
  test('completes a workout and records it on the dashboard', async ({ page }) => {
    await freshApp(page);
    await completeWorkout(page);

    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByText('1 of 20 sessions complete')).toBeVisible();
    await expect(page.getByText('Lower Body A')).toBeVisible(); // next day queued
  });

  test('resumes an unfinished workout from the dashboard', async ({ page }) => {
    await freshApp(page);
    await page.getByRole('button', { name: /Start today's workout/i }).click();
    await page.getByRole('button', { name: /Warm-up done/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByRole('button', { name: /Resume unfinished workout/i })).toBeVisible();
    await page.getByRole('button', { name: /Resume unfinished workout/i }).click();
    await expect(page.getByRole('heading', { name: 'Upper Body A' })).toBeVisible();
  });

  test('pauses the plan and shows the travel banner', async ({ page }) => {
    await freshApp(page);
    await page.getByRole('link', { name: 'Plan' }).click();

    // The seeded travel pause is present and active.
    await expect(page.getByText('Travel')).toBeVisible();
    await expect(page.getByText(/-08-10 → .*-08-16/)).toBeVisible();

    // Add a pause covering today so the dashboard banner appears. The date must be
    // computed in the browser's local timezone — the app compares local dates.
    const today = await page.evaluate(() => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    });
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByLabel('Label').fill('Test pause');
    await page.getByLabel('From').fill(today);
    await page.getByLabel('To').fill(today);
    await page.getByRole('button', { name: 'Save pause' }).click();

    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByText(/Plan paused — Test pause/)).toBeVisible();
    await expect(
      page.getByText(/After your trip, restart Week 1 and complete the full four-week block/),
    ).toBeVisible();
  });

  test('restarts Week 1 and clears logged sessions', async ({ page }) => {
    await freshApp(page);
    await completeWorkout(page);
    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByText('1 of 20 sessions complete')).toBeVisible();

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('link', { name: 'Plan' }).click();
    await page.getByRole('button', { name: 'Restart the full four-week block' }).click();

    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByText('0 of 20 sessions complete')).toBeVisible();
    await expect(page.getByText('Week 1 of 4')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upper Body A' })).toBeVisible();
  });

  test('exports the workout history to Excel', async ({ page }) => {
    await freshApp(page);
    await completeWorkout(page);

    await page.getByRole('link', { name: 'More' }).click();
    await page.getByRole('button', { name: /Settings & Backup/ }).click();

    const download = await Promise.race([
      page.waitForEvent('download', { timeout: 45_000 }),
      page
        .getByRole('button', { name: /Export workout history to Excel/i })
        .click()
        .then(() => page.waitForEvent('download', { timeout: 45_000 })),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^movement-resilience-workout-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    const path = await download.path();
    expect(path).toBeTruthy();
    // A real xlsx is a zip — check the PK magic bytes.
    expect(readFileSync(path!).subarray(0, 2).toString('binary')).toBe('PK');
  });

  test('exports and restores a JSON backup', async ({ page }, testInfo) => {
    await freshApp(page);
    await completeWorkout(page);

    await page.getByRole('link', { name: 'More' }).click();
    await page.getByRole('button', { name: /Settings & Backup/ }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export all data as JSON/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^movement-resilience-backup-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const backupPath = resolve(testInfo.outputDir, 'backup.json');
    await download.saveAs(backupPath);
    const parsed = JSON.parse(readFileSync(backupPath, 'utf8'));
    expect(parsed.app).toBe('movement-resilience');
    expect(parsed.sessions).toHaveLength(1);

    // Wipe everything, then restore from the file.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete all local data' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('0 of 20 sessions complete')).toBeVisible();

    await page.getByRole('link', { name: 'More' }).click();
    await page.getByRole('button', { name: /Settings & Backup/ }).click();
    await page.locator('input[type="file"][accept*="json"]').setInputFiles(backupPath);
    await expect(page.getByText(/Restored 1 sessions/)).toBeVisible();

    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByText('1 of 20 sessions complete')).toBeVisible();
  });

  test('is installable: manifest, service worker and offline shell', async ({ page }) => {
    await freshApp(page);

    const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
    expect(manifestHref).toBeTruthy();
    const manifest = await page.evaluate(async (href) => {
      const res = await fetch(href!);
      return res.json();
    }, manifestHref);
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#0f766e');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

    // The worker is registered with registerType 'prompt' (no clientsClaim), so it
    // only takes control of the page after the next navigation.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
      timeout: 30_000,
    });

    // Go offline and reload — the shell must still render from the cache.
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.context().setOffline(false);
  });
});
