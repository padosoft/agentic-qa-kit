import { expect, test } from '@playwright/test';

/**
 * v1.7 slice 4d — PageAgents refactored around real /api/agents data.
 *
 * Covers:
 * - Initial render falls back to the local AGENTS fixture when the
 *   server isn't reachable (mock-data mode).
 * - Install button POSTs /api/agents/:id/install and updates the
 *   card to "installed" + Uninstall.
 * - Uninstall button POSTs /api/agents/:id/uninstall.
 * - Server 5xx surfaces a toast and leaves the card state intact.
 * - Successful GET /api/agents replaces the fixture with the
 *   server's payload.
 */

async function gotoAgents(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page
    .locator('.nav-item', { hasText: /^Agents/i })
    .first()
    .click();
  await expect(page.locator('.page-title, h1').first()).toContainText(/Agents/i);
}

test.describe('Agents page', () => {
  test('falls back to the local fixture when GET /api/agents is unreachable', async ({ page }) => {
    await page.route('**/api/agents', (route) => route.abort('failed'));
    await gotoAgents(page);
    // Both fixture agents render; Claude is installed by default in
    // the local fixture so its action button reads "Uninstall".
    await expect(page.getByTestId('agent-uninstall-claude')).toBeVisible();
    await expect(page.getByTestId('agent-install-copilot')).toBeVisible();
  });

  test('empty server payload is authoritative — replaces the fixture with []', async ({ page }) => {
    // PR #38 Copilot iter 1: an empty `agents` array from the server
    // must NOT fall back to the local fixture, otherwise a fresh
    // deploy with no discovered adapters would look like it had the
    // fixture agents installed.
    await page.route('**/api/agents', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agents: [] }),
      });
    });
    await gotoAgents(page);
    // No agent cards (fixture's claude/codex/gemini/copilot all gone).
    await expect(page.getByTestId('agent-install-claude')).toHaveCount(0);
    await expect(page.getByTestId('agent-uninstall-claude')).toHaveCount(0);
    await expect(page.getByTestId('agent-install-copilot')).toHaveCount(0);
  });

  test('replaces the fixture with the server payload when GET succeeds', async ({ page }) => {
    await page.route('**/api/agents', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agents: [
            {
              schema_version: '1',
              id: 'server-only-agent',
              name: 'Server Only Agent',
              vendor: 'AcmeCorp',
              installed: false,
              last_updated: null,
              files: ['acme/agent.md'],
            },
          ],
        }),
      });
    });
    await gotoAgents(page);
    await expect(page.getByTestId('agent-install-server-only-agent')).toBeVisible();
    // The fixture's Claude card is gone — the server's list replaced it.
    await expect(page.getByTestId('agent-uninstall-claude')).toHaveCount(0);
  });

  test('Install flips the card to "Uninstall" after the POST succeeds', async ({ page }) => {
    await page.route('**/api/agents', (route) => route.abort('failed'));
    await page.route('**/api/agents/copilot/install', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agent: {
            schema_version: '1',
            id: 'copilot',
            name: 'GitHub Copilot',
            vendor: 'GitHub',
            installed: true,
            last_updated: '2026-05-20T10:00:00Z',
            files: ['.github/copilot-instructions.md'],
          },
        }),
      });
    });
    await gotoAgents(page);
    await page.getByTestId('agent-install-copilot').click();
    await expect(
      page.locator('.toast.success', { hasText: /Installed GitHub Copilot/i }),
    ).toBeVisible();
    await expect(page.getByTestId('agent-uninstall-copilot')).toBeVisible();
    await expect(page.getByTestId('agent-install-copilot')).toHaveCount(0);
  });

  test('Uninstall flips the card to "Install" after the POST succeeds', async ({ page }) => {
    await page.route('**/api/agents', (route) => route.abort('failed'));
    await page.route('**/api/agents/claude/uninstall', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agent: {
            schema_version: '1',
            id: 'claude',
            name: 'Claude Code',
            vendor: 'Anthropic',
            installed: false,
            last_updated: '2026-05-10T08:00:00Z',
            files: ['CLAUDE.md'],
          },
        }),
      });
    });
    await gotoAgents(page);
    await page.getByTestId('agent-uninstall-claude').click();
    await expect(
      page.locator('.toast.success', { hasText: /Uninstalled Claude Code/i }),
    ).toBeVisible();
    await expect(page.getByTestId('agent-install-claude')).toBeVisible();
  });

  test('5xx surfaces a toast and leaves the card state intact', async ({ page }) => {
    await page.route('**/api/agents', (route) => route.abort('failed'));
    await page.route('**/api/agents/copilot/install', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'install hook timed out' }),
      });
    });
    await gotoAgents(page);
    await page.getByTestId('agent-install-copilot').click();
    await expect(
      page.locator('.toast.error', { hasText: /install GitHub Copilot failed/i }),
    ).toBeVisible();
    // Still showing the Install button — the card didn't flip.
    await expect(page.getByTestId('agent-install-copilot')).toBeVisible();
  });
});
