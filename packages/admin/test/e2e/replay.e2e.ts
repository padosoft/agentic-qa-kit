import { expect, test } from '@playwright/test';

/**
 * Replay page — repro.sh / repro.curl / repro.playwright.ts tabs.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page
    .locator('.nav-item', { hasText: /^Replay$/ })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Replay/i);
});

test('repro.sh tab is selected by default', async ({ page }) => {
  // The "repro.sh" content has bash shebang and aqa replay command.
  await expect(page.locator('text=/#!\\/usr\\/bin\\/env bash|aqa replay/i').first()).toBeVisible();
});

test('switch to repro.curl tab', async ({ page }) => {
  await page
    .getByRole('button', { name: /repro\.curl/i })
    .first()
    .click();
  await expect(page.locator('text=/curl/i').first()).toBeVisible();
});

test('switch to repro.playwright.ts tab', async ({ page }) => {
  await page
    .getByRole('button', { name: /repro\.playwright\.ts/i })
    .first()
    .click();
  await expect(
    page.locator('text=/import .* from .@playwright\\/test|playwright/i').first(),
  ).toBeVisible();
});
