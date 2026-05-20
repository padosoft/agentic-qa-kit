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
    // Hold the captured request in a stable wrapper object — TS strict
    // flow-analysis narrows a `let` mutated inside a callback to its
    // initial value at outer access sites, but object-property writes
    // are opaque to it.
    const seen: { url: string | null; org: string | null } = { url: null, org: null };
    await page.route('**/api/audit**', async (route) => {
      const req = route.request();
      seen.url = req.url();
      seen.org = req.headers()['x-aqa-org'] ?? null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Schema-conforming Event payload: seq, ts, actor:{type,id},
        // prev_hash, hash, run_id.
        // PR #39 Copilot iter 4: schema-conforming Event — run_id at
        // the top level, EventKind enum values (underscored, not
        // dotted), prev_hash null on the chain head.
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
            {
              schema_version: '1',
              seq: 2,
              ts: '2026-05-19T10:05:00Z',
              run_id: 'run-1',
              actor: { type: 'system', id: 'runner' },
              kind: 'run_finished',
              payload: {},
              prev_hash: 'a'.repeat(64),
              hash: 'b'.repeat(64),
            },
          ],
        }),
      });
    });
    await gotoNav(page, 'Audit log');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Audit log/i);
    await expect(page.locator('text=2 events · live from /api/audit')).toBeVisible();
    expect(seen.url).toMatch(/\/api\/audit(\?|$)/);
    expect(seen.org).toBe('padosoft');
  });

  test('Audit falls back to the fixture when the endpoint fails', async ({ page }) => {
    await page.route('**/api/audit**', (route) => route.abort('failed'));
    await gotoNav(page, 'Audit log');
    // Fixture-mode sub-header (no "live from" claim).
    await expect(page.locator('text=Hash-chained, tamper-evident')).toBeVisible();
  });

  test('Queue page fetches /api/queue and renders the live jobs', async ({ page }) => {
    let hit = false;
    await page.route('**/api/queue**', async (route) => {
      hit = true;
      // PR #39 Copilot iter 2: use the SERVER's EnqueuedJob shape
      // ({status, leased_until, payload}) so the test actually
      // exercises PageQueue's adapter logic.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // PR #39 Copilot iter 4: queued jobs omit `leased_until`
        // (it's only set when the job is leased to a runner).
        body: JSON.stringify({
          jobs: [
            {
              id: 'job-live-1',
              enqueued_at: '2026-05-19T11:00:00Z',
              payload: { kind: 'aqa.run', profile: 'smoke' },
              status: 'queued',
            },
          ],
        }),
      });
    });
    await gotoNav(page, 'Queue');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Queue/i);
    expect(hit).toBe(true);
    // Live job id appears in the table. The UI renders only the last
    // 12 chars in the id column, but `job-live-1` is already <12 so
    // the full string matches the table's mono cell.
    await expect(page.locator('table.tbl', { hasText: 'job-live-1' })).toBeVisible();
  });

  test('Notifications page fetches /api/notifications with x-aqa-org', async ({ page }) => {
    const seen: { org: string | null } = { org: null };
    await page.route('**/api/notifications**', async (route) => {
      seen.org = route.request().headers()['x-aqa-org'] ?? null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ notifications: [] }),
      });
    });
    await gotoNav(page, 'Notifications');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Notifications/i);
    expect(seen.org).toBe('padosoft');
  });

  test('Cost page fetches /api/cost/summary with tenant scope + explicit MTD bounds', async ({
    page,
  }) => {
    // PR #39 Copilot iter 1: the request must carry explicit `from`/
    // `to` aligned to the current month so the server's total_usd
    // matches the "MTD spend" KPI label (default window is rolling
    // 30 days, which spans month boundaries).
    const seen: {
      org: string | null;
      project: string | null;
      from: string | null;
      to: string | null;
    } = { org: null, project: null, from: null, to: null };
    await page.route('**/api/cost/summary**', async (route) => {
      const url = new URL(route.request().url());
      seen.org = route.request().headers()['x-aqa-org'] ?? null;
      seen.project = route.request().headers()['x-aqa-project'] ?? null;
      seen.from = url.searchParams.get('from');
      seen.to = url.searchParams.get('to');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // PR #39 Copilot iter 2: schema-conforming CostSummary
        // (schema_version + tenant scope echoed back).
        // PR #39 Copilot iter 4: aligned to @aqa/schemas CostSummary
        // exactly — no extra `currency` field (the schema doesn't
        // define it). `daily` is the date→usd record used by the
        // chart.
        body: JSON.stringify({
          summary: {
            schema_version: '1',
            org: 'padosoft',
            project: 'gescat',
            from: '2026-05-01T00:00:00.000Z',
            to: '2026-05-19T23:00:00.000Z',
            total_usd: 123.45,
            by_profile: [],
            daily: {},
          },
        }),
      });
    });
    await gotoNav(page, 'Cost');
    await expect(page.locator('h1, .page-title').first()).toContainText(/Cost/i);
    expect(seen.org).toBe('padosoft');
    // PR #39 Copilot iter 2: project is now `gescat` (matches the
    // admin's selected project).
    expect(seen.project).toBe('gescat');
    // `from` is the first of the current month at 00:00 UTC.
    expect(seen.from).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(seen.to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
