import { expect, test } from '@playwright/test';

const proposal = {
  schema_version: '1',
  proposal_id: 'proposal-browser-review',
  artifact_kind: 'risk_map',
  artifact_id: 'risk-map-browser',
  artifact_sha256: 'a'.repeat(64),
  revision: 1,
  proposed_by: 'agent-browser',
  proposed_at: '2026-09-19T10:00:00.000Z',
  source: 'agent',
  status: 'pending',
};
const artifact = {
  schema_version: '1',
  artifact_kind: 'risk_map',
  artifact_id: 'risk-map-browser',
  revision: 1,
  created_at: '2026-09-19T10:00:00.000Z',
  artifact_sha256: 'a'.repeat(64),
  payload: { risks: [] },
};

test('live methodology rejection sends a reason and reads it back', async ({ page }) => {
  let rejected = false;
  let receivedBody: Record<string, unknown> | undefined;
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: { user: { id: 'reviewer-browser', name: 'Reviewer', role: 'qa-lead' } },
    }),
  );
  await page.route('**/api/methodology/proposals**', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.endsWith('/proposal-browser-review/reject') &&
      route.request().method() === 'POST'
    ) {
      receivedBody = route.request().postDataJSON();
      rejected = true;
      await route.fulfill({
        json: {
          proposal: {
            proposal: { ...proposal, status: 'rejected' },
            artifact,
            rejection: receivedBody,
          },
        },
      });
      return;
    }
    const rejection = rejected
      ? {
          schema_version: '1',
          rejection_id: 'rejection-browser',
          proposal_id: proposal.proposal_id,
          rejected_by: 'reviewer-browser',
          rejected_at: '2026-09-19T10:01:00.000Z',
          reason: 'Missing checkout invariant',
        }
      : undefined;
    if (url.pathname.endsWith('/proposal-browser-review')) {
      await route.fulfill({
        json: {
          proposal: {
            proposal: rejected ? { ...proposal, status: 'rejected' } : proposal,
            artifact,
            ...(rejection ? { rejection } : {}),
          },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        proposals: [
          {
            proposal: rejected ? { ...proposal, status: 'rejected' } : proposal,
            ...(rejection ? { rejection } : {}),
          },
        ],
      },
    });
  });

  await page.goto('/');
  const modePill = page.locator('.mode-pill').first();
  const modeClass = await modePill.getAttribute('class');
  if (modeClass?.includes('failed')) {
    await modePill.click();
    await modePill.click();
  } else if (modeClass?.includes('mock')) {
    await modePill.click();
  }
  await expect(modePill).toHaveClass(/live/);
  await page.locator('.nav-item', { hasText: /^Methodology review/ }).click();
  await expect(page.locator('[data-testid="methodology-payload"]')).toContainText('risks');
  await page.locator('#methodology-reject-reason').fill('Missing checkout invariant');
  await page.locator('[data-testid="methodology-reject"]').click();
  await expect.poll(() => receivedBody?.reason).toBe('Missing checkout invariant');
  await expect(page.getByText('Rejection recorded')).toBeVisible();
  await expect(page.getByText('Missing checkout invariant')).toBeVisible();
  await expect(page.locator('[data-testid="methodology-reject"]')).toHaveCount(0);
});

test('mock methodology review cannot fabricate a rejection', async ({ page }) => {
  await page.goto('/');
  const modePill = page.locator('.mode-pill').first();
  if ((await modePill.getAttribute('class'))?.includes('live')) {
    await modePill.click();
    await modePill.click();
  }
  await page.locator('.nav-item', { hasText: /^Methodology review/ }).click();
  const reason = page.locator('#methodology-reject-reason');
  await reason.fill('Missing checkout invariant');
  await expect(page.locator('[data-testid="methodology-reject"]')).toBeDisabled();
});

test('live approved methodology compares the previous revision and publishes it', async ({
  page,
}) => {
  let publishedBody: Record<string, unknown> | undefined;
  const approvedProposal = {
    ...proposal,
    proposal_id: 'proposal-browser-publish',
    artifact_id: 'risk-map-publish',
    revision: 2,
    artifact_sha256: 'b'.repeat(64),
    status: 'approved',
  };
  const approvedArtifact = {
    ...artifact,
    artifact_id: 'risk-map-publish',
    revision: 2,
    artifact_sha256: 'b'.repeat(64),
    payload: { risks: [{ id: 'checkout-total', severity: 'high' }] },
  };
  const previousArtifact = {
    ...approvedArtifact,
    revision: 1,
    artifact_sha256: 'c'.repeat(64),
    payload: { risks: [] },
  };
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: { user: { id: 'reviewer-browser', name: 'Reviewer', role: 'qa-lead' } },
    }),
  );
  await page.route('**/api/methodology/proposals**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/proposal-browser-publish')) {
      await route.fulfill({
        json: {
          proposal: {
            proposal: approvedProposal,
            artifact: approvedArtifact,
            approval: {
              approval_id: 'approval-publish',
              proposal_id: approvedProposal.proposal_id,
              artifact_sha256: approvedArtifact.artifact_sha256,
              revision: 2,
              approved_by: 'reviewer-browser',
              approved_at: '2026-09-19T10:01:00.000Z',
            },
          },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        proposals: [
          {
            proposal: approvedProposal,
            approval: {
              approval_id: 'approval-publish',
              proposal_id: approvedProposal.proposal_id,
              artifact_sha256: approvedArtifact.artifact_sha256,
              revision: 2,
              approved_by: 'reviewer-browser',
              approved_at: '2026-09-19T10:01:00.000Z',
            },
          },
        ],
      },
    });
  });
  await page.route('**/api/methodology/artifacts', async (route) => {
    if (route.request().method() === 'POST') {
      publishedBody = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { artifact: approvedArtifact } });
      return;
    }
    await route.fulfill({ json: { artifacts: [] } });
  });
  await page.route('**/api/methodology/artifacts/**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.pathname).toContain('/1');
    await route.fulfill({ json: { artifact: previousArtifact } });
  });
  await page.goto('/');
  const modePill = page.locator('.mode-pill').first();
  const modeClass = await modePill.getAttribute('class');
  if (modeClass?.includes('failed')) {
    await modePill.click();
    await modePill.click();
  } else if (modeClass?.includes('mock')) await modePill.click();
  await expect(modePill).toHaveClass(/live/);
  await page.locator('.nav-item', { hasText: /^Methodology review/ }).click();
  await expect(page.locator('[data-testid="methodology-revision-diff"]')).toContainText(
    'Revision 1',
  );
  await expect(page.locator('[data-testid="methodology-revision-diff"]')).toContainText(
    'checkout-total',
  );
  await page.locator('[data-testid="methodology-publish"]').click();
  await expect.poll(() => publishedBody?.proposal_id).toBe(approvedProposal.proposal_id);
  await expect(page.getByText('Publication recorded')).toBeVisible();
});
