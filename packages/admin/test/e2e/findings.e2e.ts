import { expect, test } from '@playwright/test';

/**
 * Findings — three views (Clusters / List / Kanban) + open detail.
 *
 * View switcher is rendered as <span className="seg-btn"> (not <button>),
 * so we target it via the `.seg-btn` class.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page
    .locator('.nav-item', { hasText: /^Findings/ })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Findings/i);
});

test('Findings page surfaces at least one finding ID', async ({ page }) => {
  await expect(page.locator('text=/AQA-2026-/').first()).toBeVisible({ timeout: 8000 });
});

test('switch to Kanban view shows the 5 status columns', async ({ page }) => {
  await page
    .locator('.seg-btn', { hasText: /^Kanban$/i })
    .first()
    .click();
  for (const col of ['Draft', 'Verified', 'Fixed', 'Rejected', 'Duplicate']) {
    await expect(page.locator(`text=/^${col}$/`).first()).toBeVisible({ timeout: 5000 });
  }
});

test('switch to List view shows finding IDs', async ({ page }) => {
  await page
    .locator('.seg-btn', { hasText: /^List$/i })
    .first()
    .click();
  await expect(page.locator('text=/AQA-2026-\\d{4}/').first()).toBeVisible({ timeout: 5000 });
});
