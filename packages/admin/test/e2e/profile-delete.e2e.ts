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

  test('close+reopen clears the typed confirm text (no stale state flash)', async ({ page }) => {
    // Regression test for PR #29 iter 8 (Copilot):
    // The reset effect runs only when `open` becomes true OR
    // `profileName` changes. Closing and reopening on the SAME
    // profile wouldn't fire either trigger, so the first render
    // after reopening could briefly show stale `confirmText` /
    // `error` from the prior session. handleClose now resets state
    // synchronously to avoid the flicker.
    const name = await navigateToProfileDetail(page);
    await page.getByTestId('profile-delete-btn').click();
    const confirm = page.getByTestId('profile-delete-confirm');
    await confirm.fill(name); // type the exact name → Delete enables
    await expect(page.getByTestId('profile-delete-submit')).toBeEnabled();
    // Close via the Cancel button (calls handleClose).
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    // Reopen the same profile's delete modal.
    await page.getByTestId('profile-delete-btn').click();
    // The confirm input must be empty — no stale value, no enabled
    // Delete button (which would mean a misclick could fire DELETE
    // without re-typing).
    await expect(page.getByTestId('profile-delete-confirm')).toHaveValue('');
    await expect(page.getByTestId('profile-delete-submit')).toBeDisabled();
  });

  test('typing a non-matching name leaves Delete disabled', async ({ page }) => {
    const name = await navigateToProfileDetail(page);
    await page.getByTestId('profile-delete-btn').click();
    await page.getByTestId('profile-delete-confirm').fill(`${name}-typo`);
    await expect(page.getByTestId('profile-delete-submit')).toBeDisabled();
  });

  test('exact-match name enables Delete; DELETE fires; toast shown; navigates to /profiles; row drops from list', async ({
    page,
  }) => {
    // Only intercept DELETEs — let any other HTTP method continue
    // to the dev server unmodified so unexpected GET/PUT calls don't
    // get silently fulfilled with our `{}` stub. Also match the real
    // endpoint's response shape: `DELETE /api/profiles/:name` returns
    // `{ok: true}` per @aqa/server's `asResponse({ ok: true })`.
    type Req = { url: string; method: string };
    const calls: Req[] = [];
    await page.route('**/api/profiles/*', async (route) => {
      const method = route.request().method();
      if (method !== 'DELETE') return route.continue();
      calls.push({ url: route.request().url(), method });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });
    const name = await navigateToProfileDetail(page);
    await page.getByTestId('profile-delete-btn').click();
    await page.getByTestId('profile-delete-confirm').fill(name);
    await expect(page.getByTestId('profile-delete-submit')).toBeEnabled();
    await page.getByTestId('profile-delete-submit').click();
    // (1) On success the modal closes.
    await expect(page.locator('.modal-title')).toHaveCount(0);
    // (2) Exactly one DELETE call to /api/profiles/<name>.
    expect(calls.length).toBe(1);
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toContain(`/api/profiles/${encodeURIComponent(name)}`);
    // (3) Success toast appears with the right title.
    await expect(page.locator('.toast.success', { hasText: 'Profile deleted' })).toBeVisible();
    // (4) After navigating back to /profiles, the just-deleted row
    //     no longer appears in the list (window event drops it via
    //     the App-level lifted deletedProfiles set).
    //
    // Selector: the profile name renders as <span class="id-link mono">
    // inside a <td>. An earlier version of this test used `td.mono`,
    // which matches nothing (the class is on the span, not the td)
    // so the count was always 0 and the assertion silently passed
    // even if the row was still present (Copilot caught this in
    // iter 6 review). Now we target the span directly within a row
    // AND assert the table still has other rows so the check isn't
    // vacuously satisfied by an empty table.
    await expect(page.locator('.page-title, h1').first()).toContainText(/Profiles/i);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(
      page.locator('table.tbl tbody tr', {
        has: page.locator('span.id-link.mono', { hasText: new RegExp(`^${escaped}$`) }),
      }),
    ).toHaveCount(0);
    await expect(page.locator('table.tbl tbody tr')).not.toHaveCount(0);
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
