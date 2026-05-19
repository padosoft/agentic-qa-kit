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

  test('decimal parallelism (1.5) disables Save (Number, not parseInt)', async ({ page }) => {
    // PR #30 iter 2 (Copilot): the onChange used `parseInt(v, 10)`
    // which silently truncates "1.5" → 1 and slips past the integer
    // check. Now `Number(v)` preserves the decimal so the schema
    // validation correctly rejects it.
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    await page.getByTestId('profile-edit-parallelism').fill('1.5');
    await expect(page.getByTestId('profile-edit-parallelism-err')).toContainText('1..64');
    await expect(page.getByTestId('profile-edit-submit')).toBeDisabled();
  });

  test('invalid pack slug disables Save and shows the validation hint', async ({ page }) => {
    // PR #30 iter 2 (Codex): the server's PUT handler doesn't
    // re-validate `req.body`, so without this UI check the user
    // could persist a profile with uppercase / spaced / consecutive-
    // dash pack slugs. The wizard now mirrors the @aqa/schemas Slug
    // regex.
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    await page.getByTestId('profile-edit-packs').fill('core, Bad Slug');
    await expect(page.getByTestId('profile-edit-packs-err')).toContainText(/lowercase|exceeds/);
    await expect(page.getByTestId('profile-edit-submit')).toBeDisabled();
    // Correcting the slug re-enables Save.
    await page.getByTestId('profile-edit-packs').fill('core, api');
    await expect(page.getByTestId('profile-edit-packs-err')).toHaveCount(0);
    await expect(page.getByTestId('profile-edit-submit')).toBeEnabled();
  });

  test('PUT body preserves source profile budget_minutes (not exposed in the form)', async ({
    page,
  }) => {
    // PR #30 iter 2 (Codex): the optional `budget_minutes` wall-clock
    // guard isn't a form field, but the server writes the submitted
    // object as the replacement profile — so omitting it from the
    // body would silently strip an existing value. The wizard now
    // forwards it from the source profile.
    //
    // The static admin PROFILES mock doesn't include `budget_minutes`,
    // so we inject it on the in-memory profile object directly
    // before opening the wizard.
    type Req = { method: string; body: unknown };
    const calls: Req[] = [];
    await page.route('**/api/profiles/*', async (route) => {
      const method = route.request().method();
      if (method !== 'PUT') return route.continue();
      calls.push({ method, body: route.request().postDataJSON() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: route.request().postDataJSON() }),
      });
    });
    await navigateToProfileDetail(page);
    // Inject `budget_minutes` onto the live profile object the
    // detail page is showing. The admin keeps the PROFILES array on
    // `window` (Object.assign at module scope makes them debuggable),
    // so we can mutate it in-place from the test before the user
    // opens the edit modal.
    await page.evaluate(() => {
      const w = window as unknown as { PROFILES?: Array<Record<string, unknown>> };
      const list = w.PROFILES;
      if (Array.isArray(list) && list[0]) list[0].budget_minutes = 30;
    });
    await page.getByTestId('profile-edit-btn').click();
    await page.getByTestId('profile-edit-submit').click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    expect(calls.length).toBe(1);
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.budget_minutes).toBe(30);
  });

  test('user-typed budget survives App-level 5s tick re-renders', async ({ page }) => {
    // PR #30 iter 2 (Copilot): the wizard's reset effect previously
    // depended on `initial` (memoized from `profile`), but
    // PageProfileDetail builds a fresh merged `p` object on every
    // parent render. App's 5-second `lastTick` interval re-renders
    // the whole tree, the `profile` prop changed identity, `initial`
    // re-derived, the effect fired, and the user's typed value was
    // silently wiped. The fix re-keys the effect to `[open,
    // profileName]` and reads the latest profile via a ref.
    //
    // We wait through 2 ticks (~11s) and assert the typed value is
    // still there.
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    const budget = page.getByTestId('profile-edit-budget');
    await budget.fill('42.5');
    await expect(budget).toHaveValue('42.5');
    // Two App-level ticks fire here. Without the fix, the budget
    // input would re-seed to the mock value (5) after the first
    // tick.
    await page.waitForTimeout(11_000);
    await expect(budget).toHaveValue('42.5');
  });

  test('a 64-char slug is accepted but 65 is rejected (matches Slug.max(64))', async ({ page }) => {
    // PR #30 iter 3 (Copilot): the wizard previously capped slug
    // length at 52, but @aqa/schemas Slug allows 64. The form now
    // mirrors the schema limit so a valid 53–64 char slug isn't
    // wrongly rejected.
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    const at64 = `core, ${'a'.repeat(64)}`;
    const at65 = `core, ${'a'.repeat(65)}`;
    await page.getByTestId('profile-edit-packs').fill(at64);
    await expect(page.getByTestId('profile-edit-packs-err')).toHaveCount(0);
    await expect(page.getByTestId('profile-edit-submit')).toBeEnabled();
    await page.getByTestId('profile-edit-packs').fill(at65);
    await expect(page.getByTestId('profile-edit-packs-err')).toContainText(/exceeds 64/);
    await expect(page.getByTestId('profile-edit-submit')).toBeDisabled();
  });

  test('Configuration radios reflect schema execution modes after save', async ({ page }) => {
    // PR #30 iter 3 (Copilot): the detail Configuration section
    // previously rendered only `sandbox`/`host` radios, so a profile
    // saved as `agent` (a schema mode) would render with no selected
    // radio. The section now lists all four possible modes and the
    // correct one is checked after save.
    await page.route('**/api/profiles/*', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: route.request().postDataJSON() }),
      });
    });
    await navigateToProfileDetail(page);
    // Before save, the mock's `host` radio is checked (the first
    // profile is `smoke` with execution_mode='host' in the mock).
    await expect(page.getByTestId('profile-detail-execmode-host')).toBeChecked();
    await expect(page.getByTestId('profile-detail-execmode-agent')).not.toBeChecked();
    // Save as `agent`.
    await page.getByTestId('profile-edit-btn').click();
    await page.getByTestId('profile-edit-mode').selectOption('agent');
    await page.getByTestId('profile-edit-submit').click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    // After save, the `agent` radio is checked and the legacy `host`
    // radio is not. Both schema modes must be present (the regression
    // bug was rendering NO selected mode at all).
    await expect(page.getByTestId('profile-detail-execmode-agent')).toBeChecked();
    await expect(page.getByTestId('profile-detail-execmode-host')).not.toBeChecked();
  });

  test('PageProfiles summary counts every mode present in visible rows', async ({ page }) => {
    // PR #30 iter 4 (Copilot): the summary previously hard-counted
    // only `sandbox` and `host`, so a profile saved as a schema mode
    // (`agent`/`orchestrator`) disappeared from the mix even though
    // it appears in the table. The summary is now derived from a
    // distinct-mode count over `visible`.
    await page.route('**/api/profiles/*', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: route.request().postDataJSON() }),
      });
    });
    // Save the first profile as `agent` first (re-uses the live wizard).
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-edit-btn').click();
    await page.getByTestId('profile-edit-mode').selectOption('agent');
    await page.getByTestId('profile-edit-submit').click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    // Navigate back to the list and assert `agent` appears in the
    // execution-mode mix. Mock has 4 sandbox / 1 host originally; the
    // first row is `host`-mode `smoke` profile, now overridden to
    // `agent`, so the summary should be "4 sandbox · 1 agent" (host
    // count goes to 0 and disappears).
    await page.locator('.nav-item', { hasText: /^Profiles/i }).first().click();
    const sub = page.locator('.page-sub, .page-header').first();
    await expect(sub).toContainText(/1 agent/);
    await expect(sub).toContainText(/4 sandbox/);
    await expect(sub).not.toContainText(/\bhost\b/);
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
