import { type Page, expect, test } from '@playwright/test';

/**
 * Audit Chain Viewer — the organism that justifies the panel for auditors.
 * Covers the demo flows from DESIGN-NOTES §13.
 */

async function openAudit(page: Page) {
  await page.goto('/');
  await page
    .locator('.nav-item', { hasText: /^Audit log/ })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Audit/i);
}

test('idle state shows the "Verify" call-to-action', async ({ page }) => {
  await openAudit(page);
  await expect(page.getByRole('button', { name: /Verify/i }).first()).toBeVisible();
});

test('Load good chain → Verify → CHAIN OK', async ({ page }) => {
  await openAudit(page);
  await page
    .getByRole('button', { name: /Load good chain/i })
    .first()
    .click();
  await page
    .getByRole('button', { name: /^Verify( chain)?$/i })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /CHAIN OK/i })).toBeVisible({ timeout: 10_000 });
});

test('Load tampered chain → Verify → CHAIN BROKEN', async ({ page }) => {
  await openAudit(page);
  await page
    .getByRole('button', { name: /Load tampered chain/i })
    .first()
    .click();
  await page
    .getByRole('button', { name: /^Verify( chain)?$/i })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /CHAIN BROKEN/i })).toBeVisible({
    timeout: 10_000,
  });
});

test('live /api/audit chain autoloads and verifies without demo-click', async ({ page }) => {
  await page.route('**/api/audit**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        events: [
          {
            ts: '2026-05-20T09:00:00.000Z',
            actor: { id: 'system' },
            kind: 'run.start',
            payload: {},
            prev_hash: '0'.repeat(64),
            hash: 'a'.repeat(64),
          },
          {
            ts: '2026-05-20T09:00:01.000Z',
            actor: { id: 'system' },
            kind: 'run.end',
            payload: {},
            prev_hash: 'a'.repeat(64),
            hash: 'b'.repeat(64),
          },
        ],
      }),
    });
  });
  await openAudit(page);
  await expect(page.getByText('Event timeline · 2 records')).toBeVisible();
  await page
    .getByRole('button', { name: /^Verify( chain)?$/i })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /CHAIN OK/i })).toBeVisible({ timeout: 10_000 });
});
