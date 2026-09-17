import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PostgresScimTokenStore, ScimTokenManager } from '../dist/index.js';
import { PostgresSamlReplayGuard } from '../dist/index.js';

describe('PostgresScimTokenStore', () => {
  it(
    'persists hash-only SCIM tokens across store instances',
    { skip: !process.env.AQA_TEST_POSTGRES_DSN },
    async () => {
      const dsn = process.env.AQA_TEST_POSTGRES_DSN as string;
      const firstStore = new PostgresScimTokenStore(dsn);
      const first = new ScimTokenManager(firstStore);
      const issued = await first.issue(`postgres-scim-${Date.now()}`);
      await firstStore.close();

      const secondStore = new PostgresScimTokenStore(dsn);
      const second = new ScimTokenManager(secondStore);
      assert.equal(await second.verify(issued.tenant, issued.id, issued.token), true);
      assert.equal(await second.verify(issued.tenant, issued.id, 'not-the-token'), false);
      await second.revoke(issued.tenant, issued.id);
      assert.equal(await second.verify(issued.tenant, issued.id, issued.token), false);
      await secondStore.close();
    },
  );
});

describe('PostgresSamlReplayGuard', () => {
  it(
    'claims an assertion once across store instances',
    { skip: !process.env.AQA_TEST_POSTGRES_DSN },
    async () => {
      const dsn = process.env.AQA_TEST_POSTGRES_DSN as string;
      const first = new PostgresSamlReplayGuard(dsn);
      const assertionId = `postgres-saml-${Date.now()}`;
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      assert.equal(await first.claim(assertionId, expiresAt), true);
      await first.close();
      const second = new PostgresSamlReplayGuard(dsn);
      assert.equal(await second.claim(assertionId, expiresAt), false);
      await second.close();
    },
  );
});
