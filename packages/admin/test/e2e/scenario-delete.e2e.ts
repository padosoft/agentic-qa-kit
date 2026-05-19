import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4c.6 — Scenario Delete wizard wired to
 * DELETE /api/scenarios/:id.
 *
 * Covers:
 * - Delete button opens the modal with the scenario id echoed
 * - Type-the-id-to-confirm gating
 * - Cancel doesn't fire DELETE
 * - Happy path: DELETE fires, toast, navigation back to /scenarios,
 *   deleted row gone from the list
 * - 4xx keeps the modal open with the server error inline
 * - Modal close affordances inert during in-flight DELETE
 * - Tombstone branch: navigating back to a deleted scenario id
 *   renders the "Scenario not found" state
 */

async function openFirstScenarioDetail(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page
    .locator('.nav-item', { hasText: /^Scenarios/i })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Scenarios/i);
  // Packs (api / security-owasp / security-agentic) are open by
  // default but categories nested under them aren't — expand the
  // first one. Then click the first leaf inside it.
  const firstCategory = page.locator('.tree-children > div > .tree-row').first();
  await expect(firstCategory).toBeVisible();
  await firstCategory.click();
  const firstLeaf = page.locator('.tree-children .tree-children .tree-row').first();
  await expect(firstLeaf).toBeVisible();
  await firstLeaf.click();
  // The h1 mono span is the canonical full scenario id (the tree
  // leaf shows the last-2-segments, NOT the full id).
  const idText = (await page.locator('h1 .mono').first().innerText()).trim();
  return idText;
}

test.describe('Scenario delete', () => {
  test('Delete button opens the modal with the scenario id echoed', async ({ page }) => {
    const id = await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-delete-btn').click();
    await expect(page.locator('.modal-title')).toContainText(/Delete scenario/i);
    await expect(page.getByTestId('scenario-delete-confirm')).toHaveAttribute('placeholder', id);
    await expect(page.getByTestId('scenario-delete-submit')).toBeDisabled();
  });

  test('Cancel closes the modal without firing a DELETE', async ({ page }) => {
    type Req = { method: string };
    const calls: Req[] = [];
    await page.route('**/api/scenarios/**', async (route) => {
      calls.push({ method: route.request().method() });
      await route.continue();
    });
    await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-delete-btn').click();
    await page.locator('.modal-foot').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    expect(calls.filter((c) => c.method === 'DELETE').length).toBe(0);
  });

  test('Delete stays disabled until the typed id matches', async ({ page }) => {
    const id = await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-delete-btn').click();
    const input = page.getByTestId('scenario-delete-confirm');
    await input.fill(`${id}-typo`);
    await expect(page.getByTestId('scenario-delete-submit')).toBeDisabled();
    await input.fill(id);
    await expect(page.getByTestId('scenario-delete-submit')).toBeEnabled();
  });

  test('happy path: DELETE fires, toast appears, list filters out the deleted row', async ({
    page,
  }) => {
    type Req = { url: string; method: string };
    const calls: Req[] = [];
    await page.route('**/api/scenarios/**', async (route) => {
      const method = route.request().method();
      if (method !== 'DELETE') return route.continue();
      calls.push({ url: route.request().url(), method });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: route.request().url().split('/').pop(), deleted: true }),
      });
    });
    const id = await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-delete-btn').click();
    await page.getByTestId('scenario-delete-confirm').fill(id);
    await page.getByTestId('scenario-delete-submit').click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toMatch(new RegExp(`/api/scenarios/${id.replace(/\./g, '\\.')}$`));
    await expect(page.locator('.toast.success', { hasText: /Scenario deleted/i })).toBeVisible();
    await expect(page.locator('.page-title, h1').first()).toContainText(/Scenarios/i);
    // The deleted id is filtered out of the tree.
    await expect(page.locator('.tree-row span.mono', { hasText: id })).toHaveCount(0);
  });

  test('4xx keeps the modal open and surfaces the server error', async ({ page }) => {
    await page.route('**/api/scenarios/**', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forbidden: requires risk-map:edit' }),
      });
    });
    const id = await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-delete-btn').click();
    await page.getByTestId('scenario-delete-confirm').fill(id);
    await page.getByTestId('scenario-delete-submit').click();
    await expect(
      page.locator('.modal-body .alert', { hasText: /forbidden.*risk-map:edit/i }),
    ).toBeVisible();
    await expect(page.locator('.modal-title')).toContainText(/Delete scenario/i);
  });

  test('navigating back to a deleted scenario renders the "Scenario not found" state', async ({
    page,
  }) => {
    await page.route('**/api/scenarios/**', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: route.request().url().split('/').pop(), deleted: true }),
      });
    });
    const id = await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-delete-btn').click();
    await page.getByTestId('scenario-delete-confirm').fill(id);
    await page.getByTestId('scenario-delete-submit').click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    await page.evaluate((scenarioId) => {
      // biome-ignore lint/suspicious/noExplicitAny: test-only hook
      const nav = (window as any).__aqaNavigate;
      nav?.('scenario-detail', { id: scenarioId });
    }, id);
    await expect(page.locator('h1', { hasText: /Scenario not found/i })).toBeVisible();
    await expect(page.getByTestId('scenario-detail-back')).toBeVisible();
  });

  test('modal close affordances are inert while DELETE is in flight', async ({ page }) => {
    let resolveDelete!: () => void;
    const deleteHeld = new Promise<void>((r) => {
      resolveDelete = r;
    });
    await page.route('**/api/scenarios/**', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      await deleteHeld;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'x', deleted: true }),
      });
    });
    const id = await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-delete-btn').click();
    await page.getByTestId('scenario-delete-confirm').fill(id);
    await page.getByTestId('scenario-delete-submit').click();
    await expect(page.getByTestId('scenario-delete-submit')).toContainText(/Deleting/i);
    await page.locator('.overlay').click({ force: true });
    await expect(page.locator('.modal-title')).toContainText(/Delete scenario/i);
    await page.locator('.modal-head .iconbtn').click();
    await expect(page.locator('.modal-title')).toContainText(/Delete scenario/i);
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-title')).toContainText(/Delete scenario/i);
    resolveDelete();
    await expect(page.locator('.modal-title')).toHaveCount(0);
  });
});
