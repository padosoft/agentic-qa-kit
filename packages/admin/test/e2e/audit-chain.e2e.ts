import { expect, test } from '@playwright/test';

/**
 * Audit Chain Viewer — the organism that justifies the panel for auditors.
 * Covers the demo flows from DESIGN-NOTES §13.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page
    .locator('.nav-item', { hasText: /^Audit log/ })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Audit/i);
});

test('idle state shows the "Verify" call-to-action', async ({ page }) => {
  await expect(page.getByRole('button', { name: /Verify/i }).first()).toBeVisible();
});

test('Load good chain → Verify → CHAIN OK', async ({ page }) => {
  await page
    .getByRole('button', { name: /Load good chain/i })
    .first()
    .click();
  await page
    .getByRole('button', { name: /^Verify( chain)?$/i })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /CHAIN OK/i })).toBeVisible({ timeout: 10_000 });
});

test('Load tampered chain → Verify → CHAIN BROKEN', async ({ page }) => {
  await page
    .getByRole('button', { name: /Load tampered chain/i })
    .first()
    .click();
  await page
    .getByRole('button', { name: /^Verify( chain)?$/i })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /CHAIN BROKEN/i })).toBeVisible({
    timeout: 10_000,
  });
});
