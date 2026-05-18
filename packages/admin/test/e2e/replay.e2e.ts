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

test('Replay panel exposes all three reproduction-artifact tabs', async ({ page }) => {
  await expect(page.getByRole('button', { name: /repro\.sh/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /repro\.curl/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /repro\.playwright/i }).first()).toBeVisible();
});

test('switching to the curl tab updates the body', async ({ page }) => {
  await page
    .getByRole('button', { name: /repro\.curl/i })
    .first()
    .click();
  await expect(page.locator('text=/curl/i').first()).toBeVisible();
});
