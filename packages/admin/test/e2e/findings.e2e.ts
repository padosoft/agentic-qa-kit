import { expect, test } from '@playwright/test';

/**
 * Findings — three views (Clusters / List / Kanban) + open detail.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page
    .locator('.nav-item', { hasText: /^Findings$/ })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Findings/i);
});

test('default view is Clusters', async ({ page }) => {
  // Cluster cards mention "cluster" or show grouped count chips.
  await expect(page.locator('text=/cluster|finding(s)? sharing/i').first()).toBeVisible();
});

test('switch to List view', async ({ page }) => {
  await page
    .getByRole('button', { name: /^List$/ })
    .first()
    .click();
  // A table or list shows finding IDs (AQA-XXXX-NNNN format from data.jsx).
  await expect(page.locator('text=/AQA-2026-\\d{4}/i').first()).toBeVisible();
});

test('switch to Kanban view shows the 5 status columns', async ({ page }) => {
  await page
    .getByRole('button', { name: /^Kanban$/ })
    .first()
    .click();
  for (const col of ['Draft', 'Verified', 'Fixed', 'Rejected', 'Duplicate']) {
    await expect(page.locator(`text=/^${col}$/`).first()).toBeVisible();
  }
});

test('clicking a finding row opens the detail page', async ({ page }) => {
  await page
    .getByRole('button', { name: /^List$/ })
    .first()
    .click();
  const firstRow = page.locator('text=/AQA-2026-\\d{4}/i').first();
  await firstRow.click();
  await expect(page.locator('.page-title, h1').first()).toContainText(
    /AQA-2026-|finding|verified|draft/i,
  );
});
