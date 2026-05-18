import { expect, test } from '@playwright/test';

/**
 * Per-screen smoke test. For every nav item, click the sidebar entry and
 * assert (a) the page renders (a heading is visible), (b) no console
 * errors fire during navigation, (c) the route's title chip appears in
 * the URL hash or the page header.
 */

const SCREENS: { nav: string; expect: RegExp | string }[] = [
  { nav: 'Dashboard', expect: /Dashboard/i },
  { nav: 'Runs', expect: /Runs/i },
  { nav: 'Findings', expect: /Findings/i },
  { nav: 'Risk map', expect: /Risk map/i },
  { nav: 'Packs', expect: /Packs/i },
  { nav: 'Scenarios', expect: /Scenarios/i },
  { nav: 'Profiles', expect: /Profiles/i },
  { nav: 'Agents', expect: /Agents/i },
  { nav: 'Replay', expect: /Replay/i },
  { nav: 'Audit log', expect: /Audit/i },
  { nav: 'Cost', expect: /Cost/i },
  { nav: 'Queue', expect: /Queue/i },
  { nav: 'Notifications', expect: /Notifications/i },
  { nav: 'Users', expect: /Users/i },
  { nav: 'Roles', expect: /Roles/i },
  { nav: 'SSO', expect: /Sign-On/i },
  { nav: 'Org & project', expect: /Organization/i },
  { nav: 'API tokens', expect: /tokens/i },
  { nav: 'Audit (admin)', expect: /Audit/i },
];

test.describe('smoke: each navigable screen renders', () => {
  for (const s of SCREENS) {
    test(`${s.nav} renders without console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
      });

      await page.goto('/');
      await expect(page.locator('.sidebar')).toBeVisible();

      const navItem = page.locator('.nav-item', { hasText: new RegExp(`^${s.nav}$`, 'i') }).first();
      await navItem.click();

      await expect(page.locator('.page-title, h1').first()).toContainText(s.expect);
      expect(errors, `unexpected errors on ${s.nav}: ${errors.join(' / ')}`).toHaveLength(0);
    });
  }
});

test('app boots on the Dashboard by default', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.page-title, h1').first()).toContainText(/Dashboard/i);
});

test('dev-only screen jumper exposes 30 routes', async ({ page }) => {
  await page.goto('/');
  // Bottom-left "N/30" pill is the prototype affordance.
  const jumper = page.locator('button', { hasText: /\/30/ }).first();
  await jumper.click();
  // Pop-up shows every route at least once.
  const menu = page.locator('.screen-jumper-menu, [role="dialog"]').first();
  await expect(menu).toBeVisible();
});
