import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4c.5 — Risk Edit/Save wired to PUT /api/risks/:id.
 *
 * Covers:
 * - Save button stays disabled when the title is shorter than the
 *   schema minimum (4 chars) — inline UX validation
 * - Happy path: Save fires PUT with a schema-conforming Risk body
 *   whose id matches the path, toast appears, `aqa:risk-updated`
 *   dispatches, the override sticks across re-navigations
 * - Cancel button is inert during in-flight Save (no mid-PUT
 *   navigation away from the page)
 * - 4xx surfaces the server's error message in an inline alert
 *   without leaving the editor
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
  await expect(page.locator('h1').first()).toContainText(idText);
  return idText;
}

test.describe('Risk edit', () => {
  test('Save is disabled when the title is too short and re-enables on a valid title', async ({
    page,
  }) => {
    await openFirstRiskEditor(page);
    const title = page.getByTestId('risk-edit-title');
    await title.fill('abc');
    await expect(page.getByTestId('risk-edit-title-err')).toContainText(/min 4/);
    await expect(page.getByTestId('risk-save-btn')).toBeDisabled();
    await title.fill('long enough title');
    await expect(page.getByTestId('risk-edit-title-err')).toHaveCount(0);
    await expect(page.getByTestId('risk-save-btn')).toBeEnabled();
  });

  test('happy path: PUTs the schema-conforming body and toasts; override survives a re-open', async ({
    page,
  }) => {
    type Req = { url: string; method: string; body: Record<string, unknown> };
    const calls: Req[] = [];
    await page.route('**/api/risks/**', async (route) => {
      const method = route.request().method();
      if (method !== 'PUT') return route.continue();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      calls.push({ url: route.request().url(), method, body });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ risk: body }),
      });
    });
    const id = await openFirstRiskEditor(page);
    await page.getByTestId('risk-edit-title').fill('Edited risk title');
    await page.getByTestId('risk-edit-severity').selectOption('low');
    await page.getByTestId('risk-save-btn').click();
    await expect(page.locator('.toast.success', { hasText: /Risk saved/i })).toBeVisible();
    expect(calls.length).toBe(1);
    expect(calls[0]?.method).toBe('PUT');
    // Path id is the displayed (and stored) id — no client-side
    // slugification (see app.tsx handleSave comment for rationale).
    expect(calls[0]?.url).toMatch(new RegExp(`/api/risks/${id}$`));
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.id).toBe(id);
    expect(body.title).toBe('Edited risk title');
    expect(body.severity).toBe('low');
    // Bare-string invariants on the mock row are coerced to
    // { id, statement } objects so the server's schema-validation
    // reaches the id-match check.
    const invariants = body.invariants as Array<{ id: string; statement: string }>;
    if (invariants.length > 0) {
      expect(typeof invariants[0]?.id).toBe('string');
      expect(typeof invariants[0]?.statement).toBe('string');
    }
    // Navigate away then back via the test-only navigate hook — the
    // override must still apply because the App-level updatedRisks
    // Map survives route changes. (Going through nav-clicks works in
    // a real browser but is flaky in CI due to toast overlay timing.)
    await page.evaluate((riskId) => {
      // biome-ignore lint/suspicious/noExplicitAny: test-only hook
      const nav = (window as any).__aqaNavigate;
      nav?.('risk-map', {});
      nav?.('risk-edit', { riskId });
    }, id);
    await expect(page.getByTestId('risk-edit-title')).toHaveValue('Edited risk title');
    await expect(page.getByTestId('risk-edit-severity')).toHaveValue('low');
  });

  test('saving a legacy-id risk does not break the invariants render on re-open', async ({
    page,
  }) => {
    // PR #33 iter 1 (Copilot/Codex P1): the body PUT to the server has
    // schema-coerced invariants ({ id, statement } objects), but the
    // editor renders r.invariants as bare strings. If we merged that
    // coerced shape back into updatedRisks, re-opening would crash
    // with "Objects are not valid as a React child". Broadcasting
    // only the user-facing fields (title/category/severity/likelihood)
    // sidesteps the issue. This test exercises the re-open path
    // against a risk that originally had non-empty invariants.
    await page.route('**/api/risks/**', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ risk: route.request().postDataJSON() }),
      });
    });
    const id = await openFirstRiskEditor(page);
    await page.getByTestId('risk-edit-title').fill('Edited again');
    await page.getByTestId('risk-save-btn').click();
    await expect(page.locator('.toast.success', { hasText: /Risk saved/i })).toBeVisible();
    // Re-open: the editor must still render without console errors.
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.evaluate((riskId) => {
      // biome-ignore lint/suspicious/noExplicitAny: test-only hook
      const nav = (window as any).__aqaNavigate;
      nav?.('risk-map', {});
      nav?.('risk-edit', { riskId });
    }, id);
    await expect(page.getByTestId('risk-edit-title')).toHaveValue('Edited again');
    // No "Objects are not valid as a React child" or similar render
    // crash should appear in the console.
    expect(consoleErrors.filter((m) => /not valid as a React child/i.test(m))).toEqual([]);
  });

  test('4xx surfaces the server error in an inline alert without leaving the page', async ({
    page,
  }) => {
    await page.route('**/api/risks/**', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'risk failed schema validation: title: too short' }),
      });
    });
    await openFirstRiskEditor(page);
    await page.getByTestId('risk-edit-title').fill('Some valid-ish title');
    await page.getByTestId('risk-save-btn').click();
    await expect(page.getByTestId('risk-edit-error')).toContainText(/failed schema validation/i);
    // Editor stays on the page — we didn't navigate back to the map.
    await expect(page.locator('h1').first()).not.toContainText(/Risk map/i);
  });

  test('Cancel is disabled while Save is in flight', async ({ page }) => {
    let resolvePut!: () => void;
    const putHeld = new Promise<void>((r) => {
      resolvePut = r;
    });
    await page.route('**/api/risks/**', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await putHeld;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ risk: route.request().postDataJSON() }),
      });
    });
    await openFirstRiskEditor(page);
    await page.getByTestId('risk-edit-title').fill('Some valid title');
    await page.getByTestId('risk-save-btn').click();
    await expect(page.getByTestId('risk-save-btn')).toContainText(/Saving/i);
    // Cancel button (header's) is disabled while Save is in flight.
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    resolvePut();
    await expect(page.locator('.toast.success', { hasText: /Risk saved/i })).toBeVisible();
  });
});
