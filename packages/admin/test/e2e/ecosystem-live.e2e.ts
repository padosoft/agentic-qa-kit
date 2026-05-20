import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

function nav(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('.nav-item', { hasText: new RegExp(`^${escaped}`, 'i') }).first();
}

test('ecosystem live: finding_emitted is visible in live audit and chain verifies', async ({
  page,
}) => {
  await page.goto('/');
  await nav(page, 'Audit log').click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Audit/i);
  await expect(page.getByText(/Event timeline/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finding_emitted/i)).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('button', { name: /^Verify( chain)?$/i })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /CHAIN OK/i })).toBeVisible({ timeout: 15_000 });
});
