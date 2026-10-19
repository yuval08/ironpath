import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('imports a JSON plan from Settings and keeps it after reload', async ({ page }) => {
  await page.goto('/#/settings');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await expect(gotIt).toBeVisible();
  await gotIt.click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import plan from JSON' }).click();
  await (await chooser).setFiles(resolve('docs/plan-import-example.json'));
  const active = page.getByRole('button', { name: /Upper Body — Four Weeks.*Active/ });
  await expect(active).toBeVisible();
  await page.reload();
  await expect(active).toBeVisible();
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await expect(page.getByRole('button', { name: /Upper Body — Four Weeks.*Active/ })).toBeVisible();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Upper Body — Four Weeks', { exact: true })).toBeVisible();
});
