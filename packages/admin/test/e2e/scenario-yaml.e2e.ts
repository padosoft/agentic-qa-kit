import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4c.7-admin / 4c.8-admin — Scenario Edit (PUT) and Clone
 * (POST) wired through a shared YAML-textarea modal.
 *
 * The textarea is seeded with a schema-conforming stub; the user edits
 * free-form YAML. On Save the body is parsed client-side (early UX
 * hint) and the actual contract is the server's schema validation.
 *
 * Covers:
 * - Edit button opens the modal seeded with the current scenario id
 * - Edit PUTs the schema-parsed body and toasts; modal closes on
 *   success
 * - Edit's body.id-mismatch UX warning shows when the user mutates id
 *   in the textarea
 * - Clone button opens the modal with mode=clone, EMPTY id (forces
 *   the user to choose), and rejects same-as-source / collision ids
 *   before hitting the server
 * - Clone POSTs and navigates to the new scenario detail
 * - 4xx surfaces the server error in an inline alert
 */

async function openFirstScenarioDetail(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page
    .locator('.nav-item', { hasText: /^Scenarios/i })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Scenarios/i);
  const firstCategory = page.locator('.tree-children > div > .tree-row').first();
  await expect(firstCategory).toBeVisible();
  await firstCategory.click();
  const firstLeaf = page.locator('.tree-children .tree-children .tree-row').first();
  await expect(firstLeaf).toBeVisible();
  await firstLeaf.click();
  const idText = (await page.locator('h1 .mono').first().innerText()).trim();
  return idText;
}

test.describe('Scenario YAML edit/clone', () => {
  test('Edit button opens the YAML modal seeded with the current scenario id', async ({ page }) => {
    const id = await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-edit-btn').click();
    await expect(page.locator('.modal-title')).toContainText(/Edit scenario/i);
    const textarea = page.getByTestId('scenario-yaml-textarea');
    await expect(textarea).not.toHaveValue('');
    const yaml = await textarea.inputValue();
    expect(yaml).toContain(`id: ${id}`);
    expect(yaml).toMatch(/schema_version:/);
    expect(yaml).toMatch(/risk_refs:/);
  });

  test('happy edit: PUTs the parsed body, toasts, modal closes', async ({ page }) => {
    type Req = { url: string; method: string; body: Record<string, unknown> };
    const calls: Req[] = [];
    await page.route('**/api/scenarios/**', async (route) => {
      const method = route.request().method();
      if (method !== 'PUT') return route.continue();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      calls.push({ url: route.request().url(), method, body });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ scenario: body }),
      });
    });
    const id = await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-edit-btn').click();
    await page.getByTestId('scenario-yaml-submit').click();
    await expect(page.locator('.toast.success', { hasText: /Scenario saved/i })).toBeVisible();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    expect(calls.length).toBe(1);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.body.id).toBe(id);
    expect(calls[0]?.body.schema_version).toBe('1');
  });

  test('Edit surfaces an inline UX warning when body.id is mutated to mismatch path', async ({
    page,
  }) => {
    const id = await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-edit-btn').click();
    const textarea = page.getByTestId('scenario-yaml-textarea');
    await expect(textarea).not.toHaveValue('');
    const original = await textarea.inputValue();
    await textarea.fill(original.replace(`id: ${id}`, 'id: changed-by-user'));
    await expect(page.getByTestId('scenario-yaml-uxerr')).toContainText(
      /body id "changed-by-user".*path "/i,
    );
    await expect(page.getByTestId('scenario-yaml-submit')).toBeDisabled();
  });

  test('Clone modal warns same-as-source and collision before POST', async ({ page }) => {
    const id = await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-clone-btn').click();
    const textarea = page.getByTestId('scenario-yaml-textarea');
    // The stub seeds id with empty string; type the source's id —
    // should flag "same as source".
    // Wait for the seed effect to populate the textarea before reading.
    await expect(textarea).not.toHaveValue('');
    const seeded = await textarea.inputValue();
    await textarea.fill(seeded.replace(/^id:.*/m, `id: ${id}`));
    await expect(page.getByTestId('scenario-yaml-uxerr')).toContainText(/same as the source/i);
    // Type the well-known mock id `api.idor.invoice_pdf` — collision.
    await textarea.fill(seeded.replace(/^id:.*/m, 'id: api.idor.invoice_pdf'));
    await expect(page.getByTestId('scenario-yaml-uxerr')).toContainText(/already exists/i);
    // Switch to a unique id — UX-hint clears, submit enables.
    await textarea.fill(seeded.replace(/^id:.*/m, 'id: brand-new-scenario'));
    await expect(page.getByTestId('scenario-yaml-uxerr')).toHaveCount(0);
    await expect(page.getByTestId('scenario-yaml-submit')).toBeEnabled();
  });

  test('happy clone: POSTs the body and navigates to the new scenario detail', async ({ page }) => {
    type Req = { url: string; method: string; body: Record<string, unknown> };
    const calls: Req[] = [];
    await page.route('**/api/scenarios', async (route) => {
      const method = route.request().method();
      if (method !== 'POST') return route.continue();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      calls.push({ url: route.request().url(), method, body });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ scenario: body }),
      });
    });
    await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-clone-btn').click();
    const textarea = page.getByTestId('scenario-yaml-textarea');
    await expect(textarea).not.toHaveValue('');
    const seeded = await textarea.inputValue();
    await textarea.fill(seeded.replace(/^id:.*/m, 'id: cloned-scenario-1'));
    await page.getByTestId('scenario-yaml-submit').click();
    await expect(
      page.locator('.toast.success', { hasText: /cloned-scenario-1.*created/i }),
    ).toBeVisible();
    expect(calls.length).toBe(1);
    expect(calls[0]?.body.id).toBe('cloned-scenario-1');
    // Navigated to the new scenario detail.
    await expect(page.locator('h1 .mono').first()).toContainText('cloned-scenario-1');
  });

  test('4xx keeps the modal open with the server error inline', async ({ page }) => {
    await page.route('**/api/scenarios/**', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'scenario failed schema validation: steps: required' }),
      });
    });
    await openFirstScenarioDetail(page);
    await page.getByTestId('scenario-edit-btn').click();
    await page.getByTestId('scenario-yaml-submit').click();
    await expect(page.getByTestId('scenario-yaml-error')).toContainText(
      /failed schema validation/i,
    );
    await expect(page.locator('.modal-title')).toContainText(/Edit scenario/i);
  });
});
