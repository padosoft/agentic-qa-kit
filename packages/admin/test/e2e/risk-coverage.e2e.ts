import { expect, test } from '@playwright/test';

test('risk coverage projects evidence and drift states', async ({ page }) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: /^Risk coverage/ }).click();

  await expect(page.locator('.page-title').first()).toContainText('Risk coverage');
  await expect(page.getByRole('table', { name: 'Risk coverage table' })).toBeVisible();
  await expect(page.getByText('Covered', { exact: true })).toBeVisible();
  await expect(page.getByText('Partial', { exact: true })).toBeVisible();
  await expect(page.getByText('Stale', { exact: true })).toBeVisible();
  await expect(page.getByText(/alerts?/)).toHaveCount(2);
});
