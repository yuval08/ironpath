import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('1.0.1 imports the unchanged strength foundation file and persists it', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByText(/^1\.0\.1 ·/)).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import plan from JSON' }).click();
  await (await chooser).setFiles(resolve('src/test/fixtures/phase3-strength-foundation.json'));
  const active = page.getByRole('button', { name: /Phase 3 — Strength Foundation.*Active/ });
  await expect(active).toBeVisible();
  await expect(active).toContainText('Week 1 of 10');
  await page.reload();
  await expect(active).toBeVisible();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(
    page.getByText('Phase 3 — Strength Foundation (10 Weeks)', { exact: true }),
  ).toBeVisible();
  await page.goto('/#/library/incline-barbell-bench-press');
  await expect(page.getByRole('heading', { name: 'Incline Barbell Bench Press' })).toBeVisible();
  await expect(page.getByText('Barbell, Incline bench, Rack', { exact: true })).toBeVisible();
});
