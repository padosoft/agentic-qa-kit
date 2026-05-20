import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4e — admin Operations pages (Audit, Cost, Queue,
 * Notifications) now read their data from the existing server
 * endpoints when reachable, with a graceful fall-back to local
 * fixtures so mock-data mode still renders.
 *
 * These tests assert the WIRING (request fires + page renders);
 * full content assertions stay on the fixture-mode rendering
 * tests in smoke.e2e.ts.
 */

async function gotoNav(page: import('@playwright/test').Page, label: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  // Escape regex metacharacters in `label` so a nav item like
  // "Audit (admin)" doesn't trip the parens. Mirrors smoke.e2e.ts.
  const safe = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page
    .locator('.nav-item', { hasText: new RegExp(`^${safe}`, 'i') })
    .first()
    .click();
}

test.describe('Operations pages wire-up', () => {
  test('Audit page fetches /api/audit with x-aqa-org and renders live count', async ({ page }) => {
    let captured: { url: string; org: string | null } | null = null;
    await page.route('**/api/audit', async (route) => {
      const req = route.request();
      captured = { url: req.url(), org: req.headers()['x-aqa-org'] ?? null };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            { schema_version: '1', ts: '2026-05-19T10:00:00Z', kind: 'run.started', payload: {} },
            { schema_version: '1', ts: '2026-05-19T10:05:00Z', kind: 'run.finished', payload: {} },
          ],
        }),
      });
    });
    await gotoNav(page, 'Audit log');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Audit log/i);
    await expect(page.locator('text=2 events · live from /api/audit')).toBeVisible();
    expect(captured?.url).toMatch(/\/api\/audit$/);
    expect(captured?.org).toBe('padosoft');
  });

  test('Audit falls back to the fixture when the endpoint fails', async ({ page }) => {
    await page.route('**/api/audit', (route) => route.abort('failed'));
    await gotoNav(page, 'Audit log');
    // Fixture-mode sub-header (no "live from" claim).
    await expect(page.locator('text=Hash-chained, tamper-evident')).toBeVisible();
  });

  test('Queue page fetches /api/queue and renders the live jobs', async ({ page }) => {
    let hit = false;
    await page.route('**/api/queue', async (route) => {
      hit = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs: [
            {
              id: 'job-live-1',
              kind: 'aqa.run',
              enqueued_at: '2026-05-19T11:00:00Z',
              leased_by: null,
              stuck: false,
            },
          ],
        }),
      });
    });
    await gotoNav(page, 'Queue');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Queue/i);
    expect(hit).toBe(true);
    // Live job id appears in the table (last 12 chars).
    await expect(page.locator('table.tbl', { hasText: 'job-live-1' })).toBeVisible();
  });

  test('Notifications page fetches /api/notifications with x-aqa-org', async ({ page }) => {
    let captured: { org: string | null } | null = null;
    await page.route('**/api/notifications**', async (route) => {
      captured = { org: route.request().headers()['x-aqa-org'] ?? null };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ notifications: [] }),
      });
    });
    await gotoNav(page, 'Notifications');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Notifications/i);
    expect(captured?.org).toBe('padosoft');
  });

  test('Cost page fetches /api/cost/summary with tenant scope + explicit MTD bounds', async ({
    page,
  }) => {
    // PR #39 Copilot iter 1: the request must carry explicit `from`/
    // `to` aligned to the current month so the server's total_usd
    // matches the "MTD spend" KPI label (default window is rolling
    // 30 days, which spans month boundaries).
    let captured: {
      org: string | null;
      project: string | null;
      from: string | null;
      to: string | null;
    } | null = null;
    await page.route('**/api/cost/summary**', async (route) => {
      const url = new URL(route.request().url());
      captured = {
        org: route.request().headers()['x-aqa-org'] ?? null,
        project: route.request().headers()['x-aqa-project'] ?? null,
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ summary: { total_usd: 123.45, by_profile: [], by_model: [] } }),
      });
    });
    await gotoNav(page, 'Cost');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Cost/i);
    expect(captured?.org).toBe('padosoft');
    expect(captured?.project).toBe('demo');
    // `from` is the first of the current month at 00:00 UTC.
    expect(captured?.from).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(captured?.to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
