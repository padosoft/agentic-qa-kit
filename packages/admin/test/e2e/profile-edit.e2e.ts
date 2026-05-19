import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4c.2 — Profile Edit modal wired to PUT /api/profiles/:name.
 *
 * Covers:
 * - Profile detail Edit button (previously a no-op placeholder) opens
 *   a modal with the schema-aligned editable fields
 * - Form is pre-filled from the source profile (with mock→schema
 *   coercion for `execution_mode` and `budget_usd`/`llm_budget_usd`)
 * - Validation: parallelism 1..64 integer, llm_budget_usd ≥ 0 — Save
 *   disabled until both are valid
 * - Happy path: PUTs the full schema-conforming body, shows success
 *   toast, closes the modal, and the detail page's header reflects
 *   the new value (driven by the App-level `updatedProfiles` Map +
 *   `aqa:profile-updated` CustomEvent)
 * - 4xx/5xx: modal stays open with the server's error message
 * - Modal close affordances (Escape, overlay, X) are inert while
 *   PUT is in flight — same lesson as slice 4c.1 iter 10
 */

async function navigateToProfileDetail(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page
    .locator('.nav-item', { hasText: /^Profiles/i })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Profiles/i);
  const firstRow = page.locator('table.tbl tbody tr').first();
  await expect(firstRow).toBeVisible();
  const name = await firstRow.locator('td').first().innerText();
  await firstRow.click();
  await expect(page.locator('.page-title .mono, h1 .mono').first()).toBeVisible();
  return name.trim();
}

test.describe('Profile edit', () => {
  test('Edit button opens the modal with form pre-filled', async ({ page }) => {
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    await expect(page.locator('.modal-title')).toContainText(/Edit profile/i);
    // Mode select defaults to 'orchestrator' because the mock data's
    // 'host'/'sandbox' values are not schema-valid (the wizard coerces).
    await expect(page.getByTestId('profile-edit-mode')).toHaveValue('orchestrator');
    // Parallelism defaults to 1 when the mock has no field.
    await expect(page.getByTestId('profile-edit-parallelism')).toHaveValue('1');
    // Save is enabled with the default values.
    await expect(page.getByTestId('profile-edit-submit')).toBeEnabled();
  });

  test('Cancel closes the modal without firing a PUT', async ({ page }) => {
    type Req = { method: string };
    const calls: Req[] = [];
    await page.route('**/api/profiles/*', async (route) => {
      calls.push({ method: route.request().method() });
      await route.continue();
    });
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    expect(calls.filter((c) => c.method === 'PUT').length).toBe(0);
  });

  test('out-of-range parallelism disables Save and shows the validation hint', async ({ page }) => {
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    await page.getByTestId('profile-edit-parallelism').fill('100');
    await expect(page.getByTestId('profile-edit-parallelism-err')).toContainText('1..64');
    await expect(page.getByTestId('profile-edit-submit')).toBeDisabled();
    // Within range re-enables Save.
    await page.getByTestId('profile-edit-parallelism').fill('8');
    await expect(page.getByTestId('profile-edit-parallelism-err')).toHaveCount(0);
    await expect(page.getByTestId('profile-edit-submit')).toBeEnabled();
  });

  test('negative llm_budget_usd disables Save', async ({ page }) => {
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    // type="number" inputs accept negative numbers in the value.
    await page.getByTestId('profile-edit-budget').fill('-5');
    await expect(page.getByTestId('profile-edit-budget-err')).toContainText(/≥ 0/);
    await expect(page.getByTestId('profile-edit-submit')).toBeDisabled();
  });

  test('Save PUTs the schema body; toast shown; modal closes; detail header reflects the new budget', async ({
    page,
  }) => {
    type Req = { url: string; method: string; body: unknown };
    const calls: Req[] = [];
    await page.route('**/api/profiles/*', async (route) => {
      const method = route.request().method();
      if (method !== 'PUT') return route.continue();
      const body = route.request().postDataJSON();
      calls.push({ url: route.request().url(), method, body });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: body }),
      });
    });
    const name = await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    // Change a couple of fields the user is likely to edit. After each
    // fill, assert the controlled input has actually committed the
    // value before moving on — under parallel-worker load the React
    // re-render after `fill` can lag behind Playwright's click, which
    // submits the form with the old form-state value.
    const budget = page.getByTestId('profile-edit-budget');
    await budget.fill('17.5');
    await expect(budget).toHaveValue('17.5');
    const parallelism = page.getByTestId('profile-edit-parallelism');
    await parallelism.fill('4');
    await expect(parallelism).toHaveValue('4');
    await page.getByTestId('profile-edit-mode').selectOption('agent');
    await expect(page.getByTestId('profile-edit-mode')).toHaveValue('agent');
    await page.getByTestId('profile-edit-submit').click();
    // (1) Modal closes on success.
    await expect(page.locator('.modal-title')).toHaveCount(0);
    // (2) Exactly one PUT call with a body matching the schema shape.
    expect(calls.length).toBe(1);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toContain(`/api/profiles/${encodeURIComponent(name)}`);
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.schema_version).toBe('1');
    expect(body.name).toBe(name);
    expect(body.execution_mode).toBe('agent');
    expect(body.llm_budget_usd).toBe(17.5);
    expect(body.parallelism).toBe(4);
    // (3) Success toast.
    await expect(page.locator('.toast.success', { hasText: 'Profile saved' })).toBeVisible();
    // (4) Detail header sub-line reflects the new budget value.
    //     The header sub uses `fmtUSD(p.budget_usd)` which receives
    //     the merged override; format is "$17.50" per the formatter.
    await expect(page.locator('.page-sub, .page-header').first()).toContainText(/17\.5/);
    // (5) execution_mode in the header was 'host' or 'sandbox' before
    //     (mock-only) and is now 'agent' (the saved value).
    await expect(page.locator('.page-sub, .page-header').first()).toContainText(
      /execution_mode=agent/,
    );
  });

  test('4xx keeps the modal open and surfaces the server error', async ({ page }) => {
    await page.route('**/api/profiles/*', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'parallelism must be a positive integer ≤ 64' }),
      });
    });
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    await page.getByTestId('profile-edit-submit').click();
    await expect(
      page.locator('.modal-body .alert', { hasText: /parallelism must be a positive integer/i }),
    ).toBeVisible();
    await expect(page.locator('.modal-title')).toContainText(/Edit profile/i);
  });

  test('modal close affordances are inert while PUT is in flight', async ({ page }) => {
    // Definite assignment assertion: see profile-delete.e2e.ts for
    // why we capture the resolver this way (TS otherwise narrows the
    // outer let to `null` because the assignment lives inside the
    // Promise executor closure).
    let resolvePut!: () => void;
    const putHeld = new Promise<void>((r) => {
      resolvePut = r;
    });
    await page.route('**/api/profiles/*', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await putHeld;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: route.request().postDataJSON() }),
      });
    });
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    await page.getByTestId('profile-edit-submit').click();
    await expect(page.getByTestId('profile-edit-submit')).toContainText(/Saving/i);
    // All three dismissal vectors must be no-ops while submitting.
    await page.locator('.overlay').click({ force: true });
    await expect(page.locator('.modal-title')).toContainText(/Edit profile/i);
    await page.locator('.modal-head .iconbtn').click();
    await expect(page.locator('.modal-title')).toContainText(/Edit profile/i);
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-title')).toContainText(/Edit profile/i);
    resolvePut();
    await expect(page.locator('.modal-title')).toHaveCount(0);
  });
});
