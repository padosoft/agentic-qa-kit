import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4b — Admin "Import manifest" wizard.
 *
 * Covers:
 * - clicking "Import manifest" opens the wizard
 * - Submit is disabled until YAML text is provided
 * - happy path: POSTs { yaml, force? } to /api/packs/import and shows
 *   the success panel with pack name + version on 201
 * - 400 (schema validation): wizard stays open with the server error
 * - 409 (duplicate): wizard stays open; toggling "Force overwrite"
 *   reveals the path the user takes to retry
 *
 * Admin runs in mock-data mode under Playwright; we stub the
 * endpoint with `page.route`. The server-side unit tests in
 * @aqa/server prove the endpoint contract; this e2e proves the
 * wizard talks to it correctly.
 */

const VALID_YAML = `schema_version: "1"
name: pack-imported-e2e
version: 0.1.0
description: e2e-imported pack
author: Test
license: Apache-2.0
applies_when:
  sut_type: [api]
templates: []
scenarios: []
risks: []
oracles: []
probes: []
`;

async function navigateToPacks(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page
    .locator('.nav-item', { hasText: /^Packs/i })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Packs/i);
}

test.describe('Import-manifest wizard', () => {
  test('Import-manifest button opens the wizard with disabled submit', async ({ page }) => {
    await navigateToPacks(page);
    await page.getByTestId('packs-import-btn').click();
    await expect(page.getByTestId('import-manifest-yaml')).toBeVisible();
    await expect(page.getByTestId('import-manifest-submit')).toBeDisabled();
  });

  test('happy-path 201 renders success panel with pack name + version', async ({ page }) => {
    let postedBody: { yaml?: string; force?: boolean } | null = null;
    await page.route('**/api/packs/import', async (route) => {
      postedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          pack: { name: 'pack-imported-e2e', version: '0.1.0' },
        }),
      });
    });
    await navigateToPacks(page);
    await page.getByTestId('packs-import-btn').click();
    await page.getByTestId('import-manifest-yaml').fill(VALID_YAML);
    await page.getByTestId('import-manifest-submit').click();
    const result = page.getByTestId('import-manifest-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('pack-imported-e2e');
    await expect(result).toContainText('0.1.0');
    expect(postedBody?.yaml).toContain('pack-imported-e2e');
  });

  test('schema-validation 400 keeps wizard open with error inline', async ({ page }) => {
    await page.route('**/api/packs/import', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'manifest failed schema validation: name: Required',
          code: 'EINVAL',
        }),
      });
    });
    await navigateToPacks(page);
    await page.getByTestId('packs-import-btn').click();
    await page.getByTestId('import-manifest-yaml').fill('schema_version: "1"\n');
    await page.getByTestId('import-manifest-submit').click();
    await expect(
      page.locator('.modal-body .alert', { hasText: /schema validation/i }),
    ).toBeVisible();
    await expect(page.getByTestId('import-manifest-result')).toHaveCount(0);
  });

  test('409 duplicate: user can toggle force and retry', async ({ page }) => {
    let callCount = 0;
    let lastBody: { yaml?: string; force?: boolean } | null = null;
    await page.route('**/api/packs/import', async (route) => {
      callCount += 1;
      lastBody = route.request().postDataJSON();
      if (callCount === 1) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error:
              'pack "pack-imported-e2e" already exists (currently version 0.1.0); pass force=true to overwrite',
            code: 'EEXIST',
          }),
        });
      } else {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ pack: { name: 'pack-imported-e2e', version: '0.2.0' } }),
        });
      }
    });
    await navigateToPacks(page);
    await page.getByTestId('packs-import-btn').click();
    await page.getByTestId('import-manifest-yaml').fill(VALID_YAML);
    await page.getByTestId('import-manifest-submit').click();
    // First call: 409 — error visible, wizard still open.
    await expect(page.locator('.modal-body .alert', { hasText: /already exists/i })).toBeVisible();
    expect(lastBody?.force).toBeUndefined();
    // Toggle force and resubmit.
    await page.getByTestId('import-manifest-force').check();
    await page.getByTestId('import-manifest-submit').click();
    await expect(page.getByTestId('import-manifest-result')).toBeVisible();
    expect(lastBody?.force).toBe(true);
    expect(callCount).toBe(2);
  });
});
