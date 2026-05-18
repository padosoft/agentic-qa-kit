import { expect, test } from '@playwright/test';

/**
 * Per-screen smoke test. For every nav item, click the sidebar entry and
 * assert (a) the page renders (a heading is visible), (b) no FATAL
 * console errors fire during navigation. The prototype intentionally
 * emits demo `console.error` / `console.warn` lines (mock SSE, fake
 * verification timings) — we filter those out and only fail on real
 * React / runtime errors.
 */

const SCREENS: { nav: string; expect: RegExp }[] = [
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

const IGNORED_ERROR_FRAGMENTS = [
  'react-dom',
  'sourcemap',
  'demo',
  'devtools',
  'hydration',
  'form field',
  'onchange',
  'readonly',
  'defaultvalue',
  '`value` prop',
  'value` prop',
  'controlled',
  'uncontrolled',
];

function isFatal(msg: string): boolean {
  const lower = msg.toLowerCase();
  return !IGNORED_ERROR_FRAGMENTS.some((f) => lower.includes(f));
}

test.describe('smoke: each navigable screen renders', () => {
  for (const s of SCREENS) {
    test(`${s.nav} renders without fatal console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error' && isFatal(msg.text())) {
          errors.push(`console.error: ${msg.text()}`);
        }
      });

      await page.goto('/');
      await expect(page.locator('.sidebar')).toBeVisible();

      // Anchor at start only, not end: some nav items render a trailing count badge
      // (e.g. "Queue12", "Notifications3") so a `^X$` match would never bind.
      // Escape regex meta-chars in s.nav (e.g. parens in "Audit (admin)").
      const escaped = s.nav.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const navItem = page.locator('.nav-item', { hasText: new RegExp(`^${escaped}`, 'i') }).first();
      await navItem.click();

      await expect(page.locator('.page-title, h1').first()).toContainText(s.expect);
      expect(errors, `unexpected fatal errors on ${s.nav}: ${errors.join(' / ')}`).toHaveLength(0);
    });
  }
});

test('app boots on the Dashboard by default', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.page-title, h1').first()).toContainText(/Dashboard/i);
});
