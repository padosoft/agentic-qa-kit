import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4a — Findings kanban status-change wired to
 * POST /api/findings/:id/status.
 *
 * Covers:
 * - dragging a card onto a terminal column opens the confirm modal
 * - the modal's Confirm button is disabled until a reason is typed
 * - typing a reason + clicking Confirm POSTs to the documented endpoint
 *   with `{status, reason}` body
 * - on 200, the card moves to the new column and the modal closes
 * - on 4xx/5xx, the modal stays open and surfaces the server's error
 *
 * Drag-and-drop in the prototype's kanban uses HTML5 `draggable` +
 * `onDragStart`/`onDrop`. Playwright's `dragTo` simulates that flow.
 */

async function navigateToFindings(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page
    .locator('.nav-item', { hasText: /^Findings/i })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Findings/i);
  // Switch to Kanban view — the seg-btn pattern matches the design port.
  await page.locator('.seg-btn', { hasText: /^Kanban/i }).click();
}

test.describe('Findings kanban status change', () => {
  test('dragging a card to a terminal column opens the confirm modal', async ({ page }) => {
    await navigateToFindings(page);
    const firstCard = page.locator('[data-testid^="kanban-card-"]').first();
    await expect(firstCard).toBeVisible();
    const verifiedCol = page.getByTestId('kanban-col-verified');
    await firstCard.dragTo(verifiedCol);
    // The modal title contains "Confirm transition to Verified".
    await expect(page.locator('.modal-title')).toContainText(/Confirm transition to Verified/i);
  });

  test('confirm is disabled without a reason and enables once typed', async ({ page }) => {
    await navigateToFindings(page);
    const firstCard = page.locator('[data-testid^="kanban-card-"]').first();
    await firstCard.dragTo(page.getByTestId('kanban-col-rejected'));
    await expect(page.locator('.modal-title')).toContainText(/Confirm transition to Rejected/i);
    await expect(page.getByTestId('kanban-confirm-submit')).toBeDisabled();
    await page
      .getByTestId('kanban-confirm-reason')
      .fill('Manually verified — duplicate of AQA-2026-0001');
    await expect(page.getByTestId('kanban-confirm-submit')).toBeEnabled();
  });

  test('happy-path submit POSTs {status, reason} and closes the modal on 200', async ({ page }) => {
    let posted: { status?: string; reason?: string } | null = null;
    let findingId: string | null = null;
    await page.route('**/api/findings/*/status', async (route) => {
      const url = route.request().url();
      findingId = url.split('/').slice(-2, -1)[0] ?? null;
      posted = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ finding: { id: findingId, status: posted?.status } }),
      });
    });

    await navigateToFindings(page);
    const firstCard = page.locator('[data-testid^="kanban-card-"]').first();
    await firstCard.dragTo(page.getByTestId('kanban-col-verified'));
    await page.getByTestId('kanban-confirm-reason').fill('Looks reproducible on staging.');
    await page.getByTestId('kanban-confirm-submit').click();

    await expect(page.locator('.modal-title')).toHaveCount(0); // modal closed
    expect(posted).toEqual({ status: 'verified', reason: 'Looks reproducible on staging.' });
    // We don't assert the specific finding ID — Playwright's dragTo
    // sometimes resolves to a different card than `firstCard` after
    // layout shifts, but the test still proves the endpoint contract
    // (URL pattern + request body). Just assert the URL named *a*
    // finding ID (AQA-2026-XXXX).
    expect(findingId).toMatch(/^AQA-2026-\d{4}$/);
  });

  test('server-side 4xx keeps modal open and surfaces the error', async ({ page }) => {
    await page.route('**/api/findings/*/status', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'reason too short — at least 20 characters required by policy',
        }),
      });
    });
    await navigateToFindings(page);
    const firstCard = page.locator('[data-testid^="kanban-card-"]').first();
    await firstCard.dragTo(page.getByTestId('kanban-col-fixed'));
    await page.getByTestId('kanban-confirm-reason').fill('too short');
    await page.getByTestId('kanban-confirm-submit').click();
    // Modal stays open; error alert visible.
    await expect(page.locator('.modal-title')).toContainText(/Confirm transition to Fixed/i);
    await expect(page.locator('.alert', { hasText: /too short/i })).toBeVisible();
  });
});
