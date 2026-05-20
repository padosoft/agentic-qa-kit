import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4g — admin Users and Roles pages wired to
 * GET /api/users and GET /api/roles.
 */

async function gotoNav(page: import('@playwright/test').Page, label: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  const safe = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page
    .locator('.nav-item', { hasText: new RegExp(`^${safe}`, 'i') })
    .first()
    .click();
}

test.describe('Users & Roles wire-up', () => {
  test('Users page replaces the fixture with the live /api/users payload', async ({ page }) => {
    await page.route('**/api/users**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: [
            {
              id: 'usr-live-1',
              email: 'live.user@example.com',
              display_name: 'Live User One',
              roles: ['maintainer'],
              status: 'active',
              last_active_at: '2026-05-19T12:00:00Z',
            },
          ],
        }),
      });
    });
    await gotoNav(page, 'Users');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Users/i);
    await expect(page.locator('text=Live User One')).toBeVisible();
    // Fixture users (Sara, Marco, …) are replaced — scope to the
    // Users table specifically; "Sara Conti" also appears in the
    // sidebar Account widget (that's SESSION_USER, not a table row).
    await expect(page.locator('table.tbl', { hasText: 'Sara Conti' })).toHaveCount(0);
    // Adapter derives initials from display_name.
    await expect(page.locator('.avatar.sm', { hasText: 'LU' })).toBeVisible();
  });

  test('Users page falls back to the fixture when /api/users is unreachable', async ({ page }) => {
    await page.route('**/api/users**', (route) => route.abort('failed'));
    await gotoNav(page, 'Users');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Users/i);
    // Fixture user is rendered inside the Users table.
    await expect(page.locator('table.tbl', { hasText: 'Sara Conti' })).toBeVisible();
  });

  test('Roles page renders the live permission matrix from /api/roles', async ({ page }) => {
    await page.route('**/api/roles**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          roles: [
            { role: 'viewer', permissions: ['runs:read', 'findings:read'] },
            { role: 'admin', permissions: ['admin:everything'] },
          ],
        }),
      });
    });
    await gotoNav(page, 'Roles');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Roles/i);
    // Live subtitle.
    await expect(page.locator('text=live from /api/roles')).toBeVisible();
    // Live matrix is rendered with the testid; static fixture grid is
    // suppressed.
    await expect(page.getByTestId('roles-live-matrix')).toBeVisible();
    // Permission rows include runs:read (from viewer) — admin:
    // everything wildcards across all rows.
    await expect(
      page.locator('table[data-testid="roles-live-matrix"]', { hasText: 'runs:read' }),
    ).toBeVisible();
  });

  test('Roles page falls back to the static fixture grid on error', async ({ page }) => {
    await page.route('**/api/roles**', (route) => route.abort('failed'));
    await gotoNav(page, 'Roles');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Roles/i);
    // Fixture mode renders the legacy "6 built-in roles" subtitle.
    await expect(page.locator('text=6 built-in roles')).toBeVisible();
  });
});
