import { expect, test } from '@playwright/test';

test('mock methodology review cannot fabricate a rejection', async ({ page }) => {
  await page.goto('/');
  await page.locator('.nav-item', { hasText: /^Methodology review/ }).click();
  await expect(page.locator('[data-screen-label="09 Methodology review"]')).toBeVisible();

  const reason = page.locator('#methodology-reject-reason');
  const reject = page.locator('[data-testid="methodology-reject"]');
  await expect(reason).toBeVisible();
  await reason.fill('Missing checkout invariant');
  await expect(reject).toBeDisabled();
  await expect(page.getByText('Rejected by')).toHaveCount(0);
});
