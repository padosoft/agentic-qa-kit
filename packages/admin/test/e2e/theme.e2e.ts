import { expect, test } from '@playwright/test';

/**
 * Theme toggle: light/dark via the topbar sun/moon icon. Ctrl+J shortcut.
 */

test('app boots in dark mode', async ({ page }) => {
  await page.goto('/');
  const theme = await page.locator('html').getAttribute('data-theme');
  expect(theme).toBe('dark');
});

test('Ctrl+J toggles the theme', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+J');
  await expect(async () => {
    const theme = await page.locator('html').getAttribute('data-theme');
    expect(theme).toBe('light');
  }).toPass({ timeout: 3000 });
  await page.keyboard.press('Control+J');
  await expect(async () => {
    const theme = await page.locator('html').getAttribute('data-theme');
    expect(theme).toBe('dark');
  }).toPass({ timeout: 3000 });
});
