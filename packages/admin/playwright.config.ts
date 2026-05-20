import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the AQA admin panel.
 *
 * - One spec per screen + targeted specs for the high-value organisms
 *   (audit chain viewer, findings kanban, palette ⌘K, replay tabs).
 * - Vite dev server boots automatically for every run.
 * - Chromium-only at baseline; the spec calls for Chromium as the
 *   minimum browser.
 */
export default defineConfig({
  testDir: './test/e2e',
  // Suffix is `.e2e.ts` (not the Playwright default `.spec.ts`) so the
  // monorepo's bun-test runner doesn't try to execute these — bun's
  // built-in glob picks up `*.{test,spec}.ts`.
  testMatch: ['**/*.e2e.ts'],
  testIgnore: ['**/ecosystem-live.e2e.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
