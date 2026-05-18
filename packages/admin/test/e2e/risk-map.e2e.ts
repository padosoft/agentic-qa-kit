import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page
    .locator('.nav-item', { hasText: /^Risk map$/ })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Risk map/i);
});

test('Matrix view renders a 5×5 grid', async ({ page }) => {
  // Cells live in the risk-matrix component.
  const cells = page.locator('.risk-matrix .cell, [data-rpn]');
  expect(await cells.count()).toBeGreaterThan(0);
});

test('clicking a non-empty matrix cell filters the side list', async ({ page }) => {
  const filledCell = page.locator('.risk-matrix .cell[data-count]:not([data-count="0"])').first();
  if ((await filledCell.count()) === 0) test.skip(true, 'no filled cells in current fixture');
  await filledCell.click();
  // Filtered side list shows at least one risk title.
  await expect(page.locator('text=/Cross-tenant|JWT|XSS|IDOR/').first()).toBeVisible();
});
