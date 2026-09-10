import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * End-to-end coverage for Ironpath.
 *
 * The default plan is the 14-week hypertrophy block (15 stored weeks x 4 days =
 * 60 sessions). Its general warm-up happens before the user reaches the gym, so
 * there is no in-app checklist — the session opens on a single "Start workout".
 *
 * The IndexedDB name is deliberately still `movement-resilience` even though the
 * app is now Ironpath: renaming it would orphan every existing install's data.
 */

const DB_NAME = 'movement-resilience';
const TOTAL_SESSIONS = 60;

async function freshApp(page: Page) {
  await page.goto('/');
  // Start every test from an empty database so runs are independent.
  await page.evaluate(async (dbName) => {
    await new Promise<void>((done) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => done();
      req.onerror = () => done();
      req.onblocked = () => done();
    });
  }, DB_NAME);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();
}

/**
 * Reads a whole object store out of the live database so assertions can check what
 * was actually persisted, not just what the DOM claims. Rows come back to Node and
 * are inspected here — serialising a picker into the page is needlessly fragile.
 */
function readRows<T = Record<string, unknown>>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    ([dbName, storeName]) =>
      new Promise<T[]>((done, fail) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => {
          const all = req.result.transaction(storeName, 'readonly').objectStore(storeName).getAll();
          all.onsuccess = () => done(all.result as T[]);
          all.onerror = () => fail(all.error);
        };
        req.onerror = () => fail(req.error);
      }),
    [DB_NAME, store] as const,
  );
}

interface PlanRow {
  programId: string;
  currentWeek: number;
  currentDayIndex: number;
  weeks: { phase: string; days: { prescriptions: { exerciseId: string }[] }[] }[];
}

async function activePlanRow(page: Page, programId = 'hypertrophy-14wk'): Promise<PlanRow> {
  const plans = await readRows<PlanRow>(page, 'plans');
  const plan = plans.find((p) => p.programId === programId);
  if (!plan) throw new Error(`no plan for ${programId}; found ${plans.map((p) => p.programId)}`);
  return plan;
}

/** Clears the warm-up gate and the pain-before sheet, leaving the timer running. */
async function beginSession(page: Page) {
  await page.getByRole('button', { name: /Start today's workout/i }).click();
  // The hypertrophy program has no in-app warm-up list.
  await page.getByRole('button', { name: /^Start workout$/ }).click();
  const painSheet = page.getByRole('dialog', { name: 'Pain before training' });
  await expect(painSheet).toBeVisible();
  await painSheet.getByRole('button', { name: 'Save' }).click();
}

async function completeWorkout(page: Page) {
  await beginSession(page);

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
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible();
}

/**
 * Regressions for defects found in review. Each reproduces the original failure
 * exactly, so a future refactor that reintroduces one fails here.
 */
test.describe('mid-session robustness', () => {
  test('keeps the elapsed time after a reload', async ({ page }) => {
    await freshApp(page);
    await page.clock.install();
    await beginSession(page);

    await page.clock.fastForward(300_000); // five minutes of training
    await expect(page.locator('.timer-value')).toHaveText(/[45]:\d\d/);

    // Wait for the periodic flush to actually land before reloading, otherwise
    // the test races the write it is meant to be verifying.
    await expect
      .poll(
        async () => {
          const rows = await readRows<{ elapsedSeconds: number }>(page, 'sessions');
          return rows[0]?.elapsedSeconds ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    await page.reload();
    // Previously reset to 0:00 — elapsed only reached IndexedDB on pause.
    await expect(page.locator('.timer-value')).toHaveText(/[45]:\d\d/);
  });

  test('lets you add notes to an exercise you already completed', async ({ page }) => {
    await freshApp(page);
    await beginSession(page);

    await page.getByRole('button', { name: 'Complete all' }).first().click();
    const skipRest = page.getByRole('button', { name: 'Skip rest' });
    if (await skipRest.isVisible().catch(() => false)) await skipRest.click();

    // Re-open the finished exercise and type — this used to slam the card shut
    // on the first keystroke because auto-collapse re-ran on every change.
    await page.getByRole('button', { name: /Scapular Pull-Up/ }).click();
    const notes = page.getByPlaceholder('Cues, how it felt, anything to remember').first();
    await notes.fill('shoulders felt good');
    await expect(notes).toHaveValue('shoulders felt good');

    await page.reload();
    await page.getByRole('button', { name: /Scapular Pull-Up/ }).click();
    await expect(
      page.getByPlaceholder('Cues, how it felt, anything to remember').first(),
    ).toHaveValue('shoulders felt good');
  });

  test('does not skip a training day when Finish is double-tapped', async ({ page }) => {
    await freshApp(page);
    await completeWorkout(page);

    await page.getByRole('link', { name: 'Home' }).click();
    // Cursor must land on day 2 (Lower A), not day 3.
    await expect(page.getByRole('heading', { name: /Lower A/ })).toBeVisible();
    const plan = await activePlanRow(page);
    expect({ week: plan.currentWeek, day: plan.currentDayIndex }).toEqual({ week: 1, day: 1 });
  });
});

test.describe('Ironpath — hypertrophy block', () => {
  test('completes a workout and records it on the dashboard', async ({ page }) => {
    await freshApp(page);
    await expect(page.getByText('14-Week Hypertrophy — Upper / Lower')).toBeVisible();
    await completeWorkout(page);

    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByText(`1 of ${TOTAL_SESSIONS} sessions complete`)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Lower A/ })).toBeVisible();
  });

  test('resumes an unfinished workout from the dashboard', async ({ page }) => {
    await freshApp(page);
    await beginSession(page);

    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByRole('button', { name: /Resume unfinished workout/i })).toBeVisible();
    await page.getByRole('button', { name: /Resume unfinished workout/i }).click();
    await expect(page.getByRole('heading', { name: /Upper A/ })).toBeVisible();
  });

  test('opens on reload week 1 and runs 15 weeks ending in a deload', async ({ page }) => {
    await freshApp(page);
    await page.getByRole('link', { name: 'Plan' }).click();

    await expect(page.getByText('Reload Week 1 — Technique & Load Reintroduction')).toBeVisible();
    await expect(page.getByText('Reload Week 2 — Establish Starting Loads')).toBeVisible();
    await expect(page.getByText('Deload Week — Recover & Reset')).toBeVisible();

    const weeks = (await activePlanRow(page)).weeks.map((w) => w.phase);
    expect(weeks).toHaveLength(15);
    expect(weeks.slice(0, 2)).toEqual(['reload', 'reload']);
    expect(weeks.slice(2, 14).every((p) => p === 'hypertrophy')).toBe(true);
    expect(weeks[14]).toBe('deload');
  });

  test('prescribes no deadlift variation and no strict pull-ups', async ({ page }) => {
    await freshApp(page);
    const ids = (await activePlanRow(page)).weeks.flatMap((w) =>
      w.days.flatMap((d) => d.prescriptions.map((p) => p.exerciseId)),
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => /deadlift|rdl|stiff-leg|trap-bar/i.test(id))).toEqual([]);
    expect(ids.filter((id) => id === 'strict-pull-up' || id === 'chin-up')).toEqual([]);
    // The assisted variant is what the user actually trains.
    expect(ids).toContain('band-assisted-pull-up');
  });

  test('guides through a superset without resting between A1 and A2', async ({ page }) => {
    await freshApp(page);
    await beginSession(page);

    await expect(page.getByText(/Superset A/)).toBeVisible();
    await expect(page.getByText('A1', { exact: true })).toBeVisible();
    await expect(page.getByText('A2', { exact: true })).toBeVisible();

    // Finish the prep exercise so the superset is next.
    await page.getByRole('button', { name: 'Complete all' }).first().click();
    const skipRest = page.getByRole('button', { name: 'Skip rest' });
    if (await skipRest.isVisible().catch(() => false)) await skipRest.click();

    // Completing an A1 set must NOT open the rest overlay — it points at A2 instead.
    const a1 = page.locator('.exercise-card', { hasText: 'Band-Assisted Pull-Up' }).first();
    await a1
      .getByRole('button', { name: /Mark set/ })
      .first()
      .click();
    await expect(page.locator('.rest-overlay')).toBeHidden();
    // The hint takes the place of the timer and names the exercise to move to.
    const hint = page.locator('.next-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Incline Dumbbell Press');
  });

  test('records RIR on a loaded exercise', async ({ page }) => {
    await freshApp(page);
    await beginSession(page);

    const card = page.locator('.exercise-card', { hasText: 'Incline Dumbbell Press' }).first();
    await card.scrollIntoViewIfNeeded();
    // Only the expanded card renders its set rows.
    await card.getByRole('button', { name: /Incline Dumbbell Press/ }).click();
    // RIR must be reachable on a loaded exercise — the whole block is RIR-driven.
    const rir = card.getByLabel(/RIR/i).first();
    await rir.fill('2');
    await expect(rir).toHaveValue('2');
  });
});

test.describe('multi-plan', () => {
  test('keeps a second plan and its history when switching', async ({ page }) => {
    await freshApp(page);
    await completeWorkout(page);

    await page.getByRole('link', { name: 'Plan' }).click();
    await page.getByRole('button', { name: /Start a new plan/i }).click();
    const sheet = page.getByRole('dialog', { name: 'Start a new plan' });
    await sheet.getByRole('combobox').first().selectOption('movement-resilience');
    await sheet.getByRole('button', { name: /Create and make active/i }).click();

    // The resilience plan is now active and starts empty...
    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByText('0 of 20 sessions complete')).toBeVisible();

    // ...while the hypertrophy plan's logged session is untouched.
    expect(await readRows(page, 'plans')).toHaveLength(2);
    expect(await readRows(page, 'sessions')).toHaveLength(1);
  });

  test('restarting one plan does not delete the other plan history', async ({ page }) => {
    await freshApp(page);
    await completeWorkout(page);

    await page.getByRole('link', { name: 'Plan' }).click();
    await page.getByRole('button', { name: /Start a new plan/i }).click();
    const sheet = page.getByRole('dialog', { name: 'Start a new plan' });
    await sheet.getByRole('combobox').first().selectOption('movement-resilience');
    await sheet.getByRole('button', { name: /Create and make active/i }).click();

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('link', { name: 'Plan' }).click();
    await page.getByRole('button', { name: /Restart this plan from Week 1/i }).click();

    // The hypertrophy session must survive — restart is scoped to the active plan.
    expect(await readRows(page, 'sessions')).toHaveLength(1);
  });
});

test.describe('export and backup', () => {
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

    expect(download.suggestedFilename()).toMatch(/^ironpath-workout-\d{4}-\d{2}-\d{2}\.xlsx$/);
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
    expect(download.suggestedFilename()).toMatch(/^ironpath-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const backupPath = resolve(testInfo.outputDir, 'backup.json');
    await download.saveAs(backupPath);
    const parsed = JSON.parse(readFileSync(backupPath, 'utf8'));
    expect(parsed.app).toBe('ironpath');
    expect(parsed.sessions).toHaveLength(1);

    // Wipe everything, then restore from the file.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete all local data' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(`0 of ${TOTAL_SESSIONS} sessions complete`)).toBeVisible();

    await page.getByRole('link', { name: 'More' }).click();
    await page.getByRole('button', { name: /Settings & Backup/ }).click();
    await page.locator('input[type="file"][accept*="json"]').setInputFiles(backupPath);
    await expect(page.getByText(/Restored 1 sessions/)).toBeVisible();

    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByText(`1 of ${TOTAL_SESSIONS} sessions complete`)).toBeVisible();
  });
});

test('is installable: manifest, service worker and offline shell', async ({ page }) => {
  await freshApp(page);

  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  expect(manifestHref).toBeTruthy();
  const manifest = await page.evaluate(async (href) => {
    const res = await fetch(href!);
    return res.json();
  }, manifestHref);
  expect(manifest.name).toBe('Ironpath');
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
