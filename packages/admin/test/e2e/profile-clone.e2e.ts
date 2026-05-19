import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4c.3 — Profile Clone modal wired to POST /api/profiles.
 *
 * Covers:
 * - Profile detail Clone button opens the modal with the source name
 *   read-only and a "new name" field
 * - Slug validation mirrors @aqa/schemas Slug (regex + max=64) so
 *   the user gets immediate inline feedback; Save disabled while
 *   invalid
 * - Collision check disables Save when the typed name matches an
 *   existing mock profile or another already-created clone
 * - Same-as-source name is rejected
 * - Happy path: POSTs the schema-conforming clone body, fires a
 *   toast, dispatches `aqa:profile-created`, and navigates to the
 *   new profile's detail page (which lists the cloned profile)
 * - 4xx/5xx: modal stays open with the server's error message
 * - 409 EEXIST surfaces server's error text (race: another user
 *   created a colliding profile between modal-open and submit)
 * - Modal close affordances (Escape, overlay, X) are inert while
 *   POST is in flight — same lesson as slice 4c.1 iter 10
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

test.describe('Profile clone', () => {
  test('Clone button opens the modal with the source name read-only', async ({ page }) => {
    const name = await navigateToProfileDetail(page);
    await page.getByTestId('profile-clone-btn').click();
    await expect(page.locator('.modal-title')).toContainText(/Clone profile/i);
    await expect(page.getByTestId('profile-clone-source')).toHaveValue(name);
    await expect(page.getByTestId('profile-clone-source')).toHaveAttribute('readonly', '');
    // Submit disabled until a valid new name is typed.
    await expect(page.getByTestId('profile-clone-submit')).toBeDisabled();
  });

  test('Cancel closes the modal without firing a POST', async ({ page }) => {
    type Req = { method: string };
    const calls: Req[] = [];
    await page.route('**/api/profiles', async (route) => {
      calls.push({ method: route.request().method() });
      await route.continue();
    });
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-clone-btn').click();
    await page.getByTestId('profile-clone-newname').fill('smoke-clone');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    expect(calls.filter((c) => c.method === 'POST').length).toBe(0);
  });

  test('invalid slug disables Save and shows the validation hint', async ({ page }) => {
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-clone-btn').click();
    const input = page.getByTestId('profile-clone-newname');
    await input.fill('Bad Slug');
    await expect(page.getByTestId('profile-clone-newname-err')).toContainText(/lowercase/);
    await expect(page.getByTestId('profile-clone-submit')).toBeDisabled();
    // 65-char slug exceeds Slug.max(64).
    await input.fill('a'.repeat(65));
    await expect(page.getByTestId('profile-clone-newname-err')).toContainText(/exceeds 64/);
    await expect(page.getByTestId('profile-clone-submit')).toBeDisabled();
    // Valid slug re-enables Save.
    await input.fill('valid-clone-name');
    await expect(page.getByTestId('profile-clone-newname-err')).toHaveCount(0);
    await expect(page.getByTestId('profile-clone-submit')).toBeEnabled();
  });

  test('same-as-source name is rejected with a hint', async ({ page }) => {
    const sourceName = await navigateToProfileDetail(page);
    await page.getByTestId('profile-clone-btn').click();
    await page.getByTestId('profile-clone-newname').fill(sourceName);
    await expect(page.getByTestId('profile-clone-newname-err')).toContainText(/same as source/i);
    await expect(page.getByTestId('profile-clone-submit')).toBeDisabled();
  });

  test('collision with another existing profile is rejected with a hint', async ({ page }) => {
    // The mock has at least 'smoke' and 'exploratory'. Open smoke's
    // wizard and type 'exploratory' — should flag a collision before
    // hitting POST.
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-clone-btn').click();
    await page.getByTestId('profile-clone-newname').fill('exploratory');
    await expect(page.getByTestId('profile-clone-newname-err')).toContainText(/already exists/i);
    await expect(page.getByTestId('profile-clone-submit')).toBeDisabled();
  });

  test('Clone POSTs the schema body and navigates to the new profile detail', async ({ page }) => {
    type Req = { url: string; method: string; body: unknown };
    const calls: Req[] = [];
    await page.route('**/api/profiles', async (route) => {
      const method = route.request().method();
      if (method !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      calls.push({ url: route.request().url(), method, body });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ profile: body }),
      });
    });
    const sourceName = await navigateToProfileDetail(page);
    await page.getByTestId('profile-clone-btn').click();
    await page.getByTestId('profile-clone-newname').fill('smoke-clone');
    await page.getByTestId('profile-clone-submit').click();
    // Modal closes on success.
    await expect(page.locator('.modal-title')).toHaveCount(0);
    // POST fires exactly once with a schema-conforming body.
    expect(calls.length).toBe(1);
    expect(calls[0]?.method).toBe('POST');
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.schema_version).toBe('1');
    expect(body.name).toBe('smoke-clone');
    // Source profile is `smoke` in the mock; its execution_mode is
    // 'host' which isn't schema-valid — the wizard coerces to
    // 'orchestrator' before POSTing.
    expect(body.execution_mode).toMatch(/^(orchestrator|agent)$/);
    // Success toast.
    await expect(
      page.locator('.toast.success', { hasText: /smoke-clone.*created/i }),
    ).toBeVisible();
    // Navigated to the new profile's detail page; header shows the
    // new name and the page is the not-found state's NOT shown.
    await expect(page.locator('.page-header .mono, h1 .mono').first()).toContainText('smoke-clone');
    expect(sourceName).not.toBe('smoke-clone');
  });

  test('cloned profile shows up in the Profiles list', async ({ page }) => {
    await page.route('**/api/profiles', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ profile: route.request().postDataJSON() }),
      });
    });
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-clone-btn').click();
    await page.getByTestId('profile-clone-newname').fill('list-visible-clone');
    await page.getByTestId('profile-clone-submit').click();
    await expect(page.locator('.modal-title')).toHaveCount(0);
    await page
      .locator('.nav-item', { hasText: /^Profiles/i })
      .first()
      .click();
    // The cloned profile is a NEW row in the table; assert by exact
    // text match on the name cell.
    await expect(
      page.locator('table.tbl tbody tr td span.mono', { hasText: 'list-visible-clone' }),
    ).toHaveCount(1);
  });

  test('cloning into a deleted name clears the tombstone and the new row is reachable', async ({
    page,
  }) => {
    // Delete `smoke` via the Delete wizard, then clone `exploratory`
    // into the just-freed `smoke` name. The freshly-created profile
    // must be visible in the Profiles list (no tombstone hiding it)
    // and its detail page must resolve (no "Profile not found").
    await page.route('**/api/profiles/smoke', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      await route.fulfill({ status: 204, body: '' });
    });
    await page.route('**/api/profiles', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ profile: route.request().postDataJSON() }),
      });
    });
    await navigateToProfileDetail(page);
    // Delete `smoke`.
    await page.getByTestId('profile-delete-btn').click();
    await page.getByTestId('profile-delete-confirm').fill('smoke');
    await page.getByTestId('profile-delete-submit').click();
    // Lands back on /profiles; row for `smoke` is gone.
    await expect(page.locator('.page-title, h1').first()).toContainText(/Profiles/i);
    await expect(
      page.locator('table.tbl tbody tr td span.mono', { hasText: /^smoke$/ }),
    ).toHaveCount(0);
    // Open `exploratory` and clone it into the just-freed name.
    await page
      .locator('table.tbl tbody tr td span.mono', { hasText: 'exploratory' })
      .first()
      .click();
    await page.getByTestId('profile-clone-btn').click();
    await page.getByTestId('profile-clone-newname').fill('smoke');
    await page.getByTestId('profile-clone-submit').click();
    // Modal closes and we land on the new `smoke` detail page —
    // NOT the "Profile not found" state, because the tombstone has
    // been cleared.
    await expect(page.locator('.modal-title')).toHaveCount(0);
    await expect(page.locator('.page-header .mono, h1 .mono').first()).toContainText(/^smoke$/);
    await expect(page.locator('h1', { hasText: /Profile not found/i })).toHaveCount(0);
    // The Profiles list now shows `smoke` again as a freshly-created
    // row, not the deleted mock row.
    await page
      .locator('.nav-item', { hasText: /^Profiles/i })
      .first()
      .click();
    await expect(
      page.locator('table.tbl tbody tr td span.mono', { hasText: /^smoke$/ }),
    ).toHaveCount(1);
  });

  test('4xx keeps the modal open and surfaces the server error', async ({ page }) => {
    await page.route('**/api/profiles', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'profile failed schema validation: name: too long' }),
      });
    });
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-clone-btn').click();
    await page.getByTestId('profile-clone-newname').fill('any-valid-name');
    await page.getByTestId('profile-clone-submit').click();
    await expect(
      page.locator('.modal-body .alert', { hasText: /failed schema validation/i }),
    ).toBeVisible();
    await expect(page.locator('.modal-title')).toContainText(/Clone profile/i);
  });

  test('409 EEXIST surfaces the server error (mid-flight collision race)', async ({ page }) => {
    // The wizard's own collision check uses the names visible to the
    // UI at modal-open time. If another tab/admin creates a colliding
    // profile between modal-open and submit, the server returns
    // 409 + EEXIST — that error must propagate to the modal alert.
    await page.route('**/api/profiles', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'profile "race-winner" already exists; PUT /api/profiles/race-winner to update',
          code: 'EEXIST',
        }),
      });
    });
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-clone-btn').click();
    await page.getByTestId('profile-clone-newname').fill('race-winner');
    await page.getByTestId('profile-clone-submit').click();
    await expect(
      page.locator('.modal-body .alert', { hasText: /race-winner.*already exists/i }),
    ).toBeVisible();
    await expect(page.locator('.modal-title')).toContainText(/Clone profile/i);
  });

  test('modal close affordances are inert while POST is in flight', async ({ page }) => {
    let resolvePost!: () => void;
    const postHeld = new Promise<void>((r) => {
      resolvePost = r;
    });
    await page.route('**/api/profiles', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await postHeld;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ profile: route.request().postDataJSON() }),
      });
    });
    await navigateToProfileDetail(page);
    await page.getByTestId('profile-clone-btn').click();
    await page.getByTestId('profile-clone-newname').fill('inflight-clone');
    await page.getByTestId('profile-clone-submit').click();
    await expect(page.getByTestId('profile-clone-submit')).toContainText(/Cloning/i);
    await page.locator('.overlay').click({ force: true });
    await expect(page.locator('.modal-title')).toContainText(/Clone profile/i);
    await page.locator('.modal-head .iconbtn').click();
    await expect(page.locator('.modal-title')).toContainText(/Clone profile/i);
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-title')).toContainText(/Clone profile/i);
    resolvePost();
    await expect(page.locator('.modal-title')).toHaveCount(0);
  });
});
