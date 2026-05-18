import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 3 — Admin Create-pack wizard e2e tests.
 *
 * Covers:
 * - clicking "Create pack" on the Packs screen opens the wizard
 * - slug client-side validation surfaces an error and disables submit
 * - on submit, the wizard POSTs to /api/packs/scaffold and renders the
 *   server's pack_dir + files in a success panel
 * - on server-side 409 (already exists) the wizard shows the error
 *   without closing
 *
 * The dev server has no backend wired (admin runs in mock-data mode),
 * so each test installs a Playwright route mock for /api/packs/scaffold
 * that fakes the server response. This proves the wizard talks to the
 * documented endpoint contract; the server unit tests in @aqa/server
 * prove the endpoint itself behaves correctly. Both ends together close
 * the loop.
 */

async function navigateToPacks(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page
    .locator('.nav-item', { hasText: /^Packs/i })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Packs/i);
}

test.describe('Create-pack wizard', () => {
  test('Create-pack button opens the wizard with required fields', async ({ page }) => {
    await navigateToPacks(page);
    await page.getByTestId('packs-create-btn').click();
    await expect(page.getByTestId('create-pack-slug')).toBeVisible();
    await expect(page.getByTestId('create-pack-sut')).toBeVisible();
    // Submit button is disabled until a valid slug is entered.
    await expect(page.getByTestId('create-pack-submit')).toBeDisabled();
  });

  test('invalid slug surfaces an error and keeps submit disabled', async ({ page }) => {
    await navigateToPacks(page);
    await page.getByTestId('packs-create-btn').click();
    const slug = page.getByTestId('create-pack-slug');
    await slug.fill('Bad Name!');
    // Hint text turns into the error message. The wizard renders inside
    // .modal-body, so scope the locator there to avoid colliding with
    // any other .field-hint on the page (e.g. forms in modals stacked
    // behind us, or hints in side panels).
    await expect(page.locator('.modal-body .field-hint').first()).toContainText(/lowercase|chars/i);
    await expect(page.getByTestId('create-pack-submit')).toBeDisabled();
  });

  test('valid slug + happy-path 201 renders success panel with pack_dir', async ({ page }) => {
    // Mock the server endpoint before navigating so the route is in place
    // by the time the wizard's fetch fires.
    await page.route('**/api/packs/scaffold', async (route) => {
      const body = route.request().postDataJSON();
      expect(body.slug).toBe('pack-e2e-demo');
      expect(body.sut_type).toBe('api');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          pack_dir: '/tmp/aqa-demo/packs/pack-e2e-demo',
          files: ['pack.yaml', 'scenarios/starter.yaml', 'risks/starter.yaml', 'README.md'],
        }),
      });
    });
    await navigateToPacks(page);
    await page.getByTestId('packs-create-btn').click();
    await page.getByTestId('create-pack-slug').fill('pack-e2e-demo');
    await page.getByTestId('create-pack-submit').click();
    const result = page.getByTestId('create-pack-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('/tmp/aqa-demo/packs/pack-e2e-demo');
    await expect(result).toContainText('pack.yaml');
  });

  test('server-side 409 conflict renders error and keeps wizard open', async ({ page }) => {
    await page.route('**/api/packs/scaffold', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error:
            'pack directory /tmp/aqa-demo/packs/pack-e2e-dup already exists; pass --force to overwrite',
        }),
      });
    });
    await navigateToPacks(page);
    await page.getByTestId('packs-create-btn').click();
    await page.getByTestId('create-pack-slug').fill('pack-e2e-dup');
    await page.getByTestId('create-pack-submit').click();
    // The error alert appears, the form stays mounted, and the result
    // panel does NOT appear.
    await expect(page.locator('.alert', { hasText: /already exists/i })).toBeVisible();
    await expect(page.getByTestId('create-pack-result')).toHaveCount(0);
    // Toggling "Force overwrite" is the documented next step — assert it's reachable.
    await page.getByTestId('create-pack-advanced-toggle').click();
    await expect(page.getByTestId('create-pack-force')).toBeVisible();
  });
});
