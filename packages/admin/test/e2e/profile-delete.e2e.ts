import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4c.1 — Profile Delete confirmation modal wired to
 * DELETE /api/profiles/:name.
 *
 * Covers:
 * - Profile detail page has a Delete button (previously absent)
 * - Clicking it opens a confirmation modal that requires typing the
 *   profile name (GitHub-style "type to confirm" anti-footgun pattern)
 * - Delete button stays disabled until the typed name matches exactly
 * - Happy path: DELETEs /api/profiles/<name>, shows success toast,
 *   navigates back to the profiles list
 * - 4xx/5xx: modal stays open with the server's error message
 *
 * The server endpoint exists since v1.4 (`DELETE /api/profiles/:name`),
 * so this slice is pure UI wiring + e2e.
 */

async function navigateToProfileDetail(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page
    .locator('.nav-item', { hasText: /^Profiles/i })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Profiles/i);
  // Click the first profile row to open detail. The prototype renders
  // profiles as table rows where the entire row is clickable.
  const firstRow = page.locator('table.tbl tbody tr').first();
  await expect(firstRow).toBeVisible();
  const name = await firstRow.locator('td').first().innerText();
  await firstRow.click();
  // Profile detail header shows the name as a mono span.
  await expect(page.locator('.page-title .mono, h1 .mono').first()).toBeVisible();
  return name.trim();
}

test.describe('Profile delete confirmation', () => {
  test('Delete button opens the confirmation modal', async ({ page }) => {
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-delete-btn').click();
    await expect(page.locator('.modal-title')).toContainText(/Delete profile/i);
    await expect(page.getByTestId('profile-delete-confirm')).toBeVisible();
    // Delete is disabled until the user types the name.
    await expect(page.getByTestId('profile-delete-submit')).toBeDisabled();
  });

  test('typing a non-matching name leaves Delete disabled', async ({ page }) => {
    const name = await navigateToProfileDetail(page);
    await page.getByTestId('profile-delete-btn').click();
    await page.getByTestId('profile-delete-confirm').fill(`${name}-typo`);
    await expect(page.getByTestId('profile-delete-submit')).toBeDisabled();
  });

  test('exact-match name enables Delete and DELETE fires on click', async ({ page }) => {
    type Req = { url: string; method: string };
    const calls: Req[] = [];
    await page.route('**/api/profiles/*', async (route) => {
      calls.push({ url: route.request().url(), method: route.request().method() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    const name = await navigateToProfileDetail(page);
    await page.getByTestId('profile-delete-btn').click();
    await page.getByTestId('profile-delete-confirm').fill(name);
    await expect(page.getByTestId('profile-delete-submit')).toBeEnabled();
    await page.getByTestId('profile-delete-submit').click();
    // On success the modal closes (we navigate back to /profiles).
    await expect(page.locator('.modal-title')).toHaveCount(0);
    // Exactly one DELETE call to /api/profiles/<name>.
    const deletes = calls.filter((c) => c.method === 'DELETE');
    expect(deletes.length).toBe(1);
    expect(deletes[0]?.url).toContain(`/api/profiles/${encodeURIComponent(name)}`);
  });

  test('4xx keeps modal open and surfaces the server error', async ({ page }) => {
    await page.route('**/api/profiles/*', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'profile is referenced by 3 active runs; cancel them first',
        }),
      });
    });
    const name = await navigateToProfileDetail(page);
    await page.getByTestId('profile-delete-btn').click();
    await page.getByTestId('profile-delete-confirm').fill(name);
    await page.getByTestId('profile-delete-submit').click();
    await expect(
      page.locator('.modal-body .alert', { hasText: /referenced by 3 active runs/i }),
    ).toBeVisible();
    // Modal still open.
    await expect(page.locator('.modal-title')).toContainText(/Delete profile/i);
  });
});
