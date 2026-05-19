import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4c.4 — Risk Delete wizard wired to DELETE /api/risks/:id.
 *
 * Covers:
 * - Risk editor "Delete" button opens the modal with the risk id
 *   echoed in the confirm prompt
 * - Type-to-confirm: Delete stays disabled until the typed text
 *   matches the risk id exactly
 * - Cancel closes the modal without firing a DELETE
 * - Happy path: DELETE fires, success toast, dispatched
 *   `aqa:risk-deleted`, navigation back to the Risk map; the deleted
 *   risk no longer appears in the matrix list
 * - 4xx keeps the modal open and surfaces the server error
 * - Modal close affordances (Escape / overlay / X) are inert while
 *   DELETE is in flight — same lesson as slice 4c.1 iter 10
 */

async function openFirstRiskEditor(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page
    .locator('.nav-item', { hasText: /^Risk map/i })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Risk map/i);
  const firstRow = page
    .locator('.card-body .row.gap-10 .mono.tertiary')
    .filter({ hasText: /^risk_/ })
    .first();
  await expect(firstRow).toBeVisible();
  const idText = (await firstRow.innerText()).split('·')[0]?.trim() ?? '';
  await firstRow.click();
  // The risk editor's PageHeader stamps the id into an h1 inside a
  // span with mono font (inline-styled, not classed). Match the h1
  // text directly instead of relying on a .mono descendant.
  await expect(page.locator('h1').first()).toContainText(idText);
  return idText;
}

test.describe('Risk delete', () => {
  test('Delete button opens the modal with the risk id in the confirm hint', async ({ page }) => {
    const id = await openFirstRiskEditor(page);
    await page.getByTestId('risk-delete-btn').click();
    await expect(page.locator('.modal-title')).toContainText(/Delete risk/i);
    // Confirm-hint label echoes the id; the input placeholder also
    // shows the id so the user knows what to type.
    await expect(page.getByTestId('risk-delete-confirm')).toHaveAttribute('placeholder', id);
    await expect(page.getByTestId('risk-delete-submit')).toBeDisabled();
  });

  test('Cancel closes the modal without firing a DELETE', async ({ page }) => {
    type Req = { method: string };
    const calls: Req[] = [];
    await page.route('**/api/risks/**', async (route) => {
      calls.push({ method: route.request().method() });
      await route.continue();
    });
    await openFirstRiskEditor(page);
    await page.getByTestId('risk-delete-btn').click();
    // The risk editor has its own "Cancel" button in the page header
    // (navigates back to the risk map). Scope to the modal footer so
    // we exercise the wizard's Cancel, not the editor's.
    await page.locator('.modal-foot').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    expect(calls.filter((c) => c.method === 'DELETE').length).toBe(0);
  });

  test('Delete stays disabled until the typed id matches the risk id exactly', async ({ page }) => {
    const id = await openFirstRiskEditor(page);
    await page.getByTestId('risk-delete-btn').click();
    const input = page.getByTestId('risk-delete-confirm');
    await input.fill(`${id}-typo`);
    await expect(page.getByTestId('risk-delete-submit')).toBeDisabled();
    await input.fill(id);
    await expect(page.getByTestId('risk-delete-submit')).toBeEnabled();
  });

  test('happy path: DELETE fires, toast appears, and we land on the risk map without the deleted row', async ({
    page,
  }) => {
    type Req = { url: string; method: string };
    const calls: Req[] = [];
    await page.route('**/api/risks/**', async (route) => {
      const method = route.request().method();
      if (method !== 'DELETE') return route.continue();
      calls.push({ url: route.request().url(), method });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: route.request().url().split('/').pop(), deleted: true }),
      });
    });
    const id = await openFirstRiskEditor(page);
    await page.getByTestId('risk-delete-btn').click();
    await page.getByTestId('risk-delete-confirm').fill(id);
    await page.getByTestId('risk-delete-submit').click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    expect(calls.length).toBe(1);
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toMatch(new RegExp(`/api/risks/${id}$`));
    await expect(page.locator('.toast.success', { hasText: /Risk deleted/i })).toBeVisible();
    await expect(page.locator('.page-title, h1').first()).toContainText(/Risk map/i);
    // The row for the deleted id is gone from the matrix list.
    await expect(
      page.locator('.card-body .mono.tertiary', { hasText: new RegExp(`^${id}\\b`) }),
    ).toHaveCount(0);
  });

  test('4xx keeps the modal open and surfaces the server error', async ({ page }) => {
    await page.route('**/api/risks/**', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forbidden: requires risk-map:edit' }),
      });
    });
    const id = await openFirstRiskEditor(page);
    await page.getByTestId('risk-delete-btn').click();
    await page.getByTestId('risk-delete-confirm').fill(id);
    await page.getByTestId('risk-delete-submit').click();
    await expect(
      page.locator('.modal-body .alert', { hasText: /forbidden.*risk-map:edit/i }),
    ).toBeVisible();
    await expect(page.locator('.modal-title')).toContainText(/Delete risk/i);
  });

  test('navigating back to a deleted risk renders the "Risk not found" state', async ({ page }) => {
    // After a successful DELETE, the App-level deletedRisks Set keeps
    // the id tombstoned. A stale link or programmatic navigation to
    // /risk-edit with that id must show the "no such risk" state
    // instead of silently re-rendering the underlying mock row — so a
    // user clicking an old notification/audit-log link sees the
    // tombstone, not the dead profile. There's no URL-based routing
    // in this SPA so we drive the navigation through the test-only
    // window.__aqaNavigate hook (mirrors __aqaApiUrl).
    await page.route('**/api/risks/**', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: route.request().url().split('/').pop(), deleted: true }),
      });
    });
    const id = await openFirstRiskEditor(page);
    await page.getByTestId('risk-delete-btn').click();
    await page.getByTestId('risk-delete-confirm').fill(id);
    await page.getByTestId('risk-delete-submit').click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    await expect(page.locator('.page-title, h1').first()).toContainText(/Risk map/i);
    // Programmatically re-navigate to the deleted risk — the only
    // path users could otherwise reach is through an external link
    // or browser-back (neither is testable in this SPA).
    await page.evaluate((riskId) => {
      // biome-ignore lint/suspicious/noExplicitAny: test-only hook
      (window as any).__aqaNavigate?.('risk-edit', { riskId });
    }, id);
    await expect(page.locator('h1', { hasText: /Risk not found/i })).toBeVisible();
    await expect(page.locator('[data-testid="risk-detail-back"]')).toBeVisible();
  });

  test('modal close affordances are inert while DELETE is in flight', async ({ page }) => {
    let resolveDelete!: () => void;
    const deleteHeld = new Promise<void>((r) => {
      resolveDelete = r;
    });
    await page.route('**/api/risks/**', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      await deleteHeld;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'x', deleted: true }),
      });
    });
    const id = await openFirstRiskEditor(page);
    await page.getByTestId('risk-delete-btn').click();
    await page.getByTestId('risk-delete-confirm').fill(id);
    await page.getByTestId('risk-delete-submit').click();
    await expect(page.getByTestId('risk-delete-submit')).toContainText(/Deleting/i);
    await page.locator('.overlay').click({ force: true });
    await expect(page.locator('.modal-title')).toContainText(/Delete risk/i);
    await page.locator('.modal-head .iconbtn').click();
    await expect(page.locator('.modal-title')).toContainText(/Delete risk/i);
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-title')).toContainText(/Delete risk/i);
    resolveDelete();
    await expect(page.locator('.modal-title')).toHaveCount(0);
  });
});
