import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4f — Admin section pages (API tokens, Org & project,
 * Audit-admin) now read from the existing server endpoints with
 * graceful fixture fallback. Users/Roles/SSO are intentionally
 * deferred — no server scaffolding exists for them yet (would
 * require new schemas + routes), so the slice ships what's wirable.
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

test.describe('Admin-section wire-up', () => {
  test('API tokens page fetches /api/tokens with x-aqa-org', async ({ page }) => {
    const seen: { org: string | null } = { org: null };
    await page.route('**/api/tokens**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      seen.org = route.request().headers()['x-aqa-org'] ?? null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // PR #40 Copilot iter 1: schema-conforming @aqa/schemas
        // ApiToken (display_name, prefix, owner, last_used_at,
        // ApiTokenScope enum values).
        body: JSON.stringify({
          tokens: [
            {
              schema_version: '1',
              id: 'tok-live-1',
              org: 'padosoft',
              prefix: 'aqa_pat_abcd1234',
              owner: 'svc_ci',
              display_name: 'Live token from server',
              scopes: ['runs:create', 'findings:read'],
              created_at: '2026-05-01T00:00:00Z',
              last_used_at: '2026-05-19T12:00:00Z',
            },
          ],
        }),
      });
    });
    await gotoNav(page, 'API tokens');
    await expect(page.locator('h1, .page-title').first()).toContainText(/API tokens/i);
    // Live token shows up; fixture tokens are replaced.
    await expect(page.locator('text=Live token from server')).toBeVisible();
    await expect(page.locator('text=CI · GitHub Actions')).toHaveCount(0);
    expect(seen.org).toBe('padosoft');
  });

  test('Org & project page fetches /api/orgs and reflects the live list in the subtitle', async ({
    page,
  }) => {
    await page.route('**/api/orgs**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          orgs: [
            { slug: 'padosoft', name: 'Padosoft' },
            { slug: 'acme', name: 'Acme Corp' },
          ],
        }),
      });
    });
    await gotoNav(page, 'Org & project');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Organization/i);
    // Subtitle joins the live orgs.
    await expect(page.locator('text=padosoft, acme')).toBeVisible();
  });

  test('Org page falls back to "padosoft" when /api/orgs is unreachable', async ({ page }) => {
    await page.route('**/api/orgs**', (route) => route.abort('failed'));
    await gotoNav(page, 'Org & project');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Organization/i);
    // The fixture-mode subtitle reads "padosoft".
    await expect(page.locator('.page-header').first()).toContainText('padosoft');
  });

  test('Audit (admin) page fetches /api/audit and renders the live count', async ({ page }) => {
    await page.route('**/api/audit**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            {
              schema_version: '1',
              seq: 1,
              ts: '2026-05-19T10:00:00Z',
              run_id: 'run-1',
              actor: { type: 'system', id: 'runner' },
              kind: 'run_started',
              payload: {},
              prev_hash: null,
              hash: 'a'.repeat(64),
            },
          ],
        }),
      });
    });
    await gotoNav(page, 'Audit (admin)');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Audit/i);
    await expect(page.locator('text=1 events · live from /api/audit (admin)')).toBeVisible();
  });
});
