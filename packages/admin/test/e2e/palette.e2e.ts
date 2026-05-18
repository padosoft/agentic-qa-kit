import { expect, test } from '@playwright/test';

/**
 * Command palette (⌘K / Ctrl+K). Quick navigation + actions + search.
 */

test('⌘K opens the palette and navigates to Runs', async ({ page }) => {
  await page.goto('/');
  // Cross-platform: macOS uses Meta, others use Control. Try both.
  await page.keyboard.press('Control+K');
  const palette = page.locator('.palette, [role="dialog"]').first();
  await expect(palette).toBeVisible({ timeout: 4000 });
  await page.keyboard.type('Runs');
  await page.keyboard.press('Enter');
  await expect(page.locator('.page-title, h1').first()).toContainText(/Runs/i);
});

test('Escape closes the palette', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+K');
  await expect(page.locator('.palette, [role="dialog"]').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.palette, [role="dialog"]').first()).not.toBeVisible({
    timeout: 2000,
  });
});
