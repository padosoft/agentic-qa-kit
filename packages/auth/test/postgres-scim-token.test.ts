import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PostgresMfaCredentialStore,
  PostgresScimRateLimiter,
  PostgresScimTokenStore,
  ScimTokenManager,
} from '../dist/index.js';
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

describe('PostgresScimRateLimiter', () => {
  it(
    'shares an atomic tenant window across limiter instances',
    { skip: !process.env.AQA_TEST_POSTGRES_DSN },
    async () => {
      const dsn = process.env.AQA_TEST_POSTGRES_DSN as string;
      const tenant = `postgres-rate-${Date.now()}`;
      const first = new PostgresScimRateLimiter(dsn, { max_requests: 1, window_ms: 60_000 });
      const second = new PostgresScimRateLimiter(dsn, { max_requests: 1, window_ms: 60_000 });
      assert.equal(await first.allow(tenant), true);
      assert.equal(await second.allow(tenant), false);
      await first.close();
      await second.close();
    },
  );
});

describe('PostgresMfaCredentialStore', () => {
  it(
    'persists tenant-scoped protected MFA metadata across store instances',
    { skip: !process.env.AQA_TEST_POSTGRES_DSN },
    async () => {
      const dsn = process.env.AQA_TEST_POSTGRES_DSN as string;
      const tenant = `tenant-${Date.now()}`;
      const first = new PostgresMfaCredentialStore(dsn);
      await first.put({
        tenant_id: tenant,
        user_id: 'mfa-user',
        protected_secret: 'kms:ciphertext',
        recovery_code_hashes: ['hash-a'],
        enabled_at: new Date().toISOString(),
      });
      await first.close();
      const second = new PostgresMfaCredentialStore(dsn);
      const loaded = await second.get(tenant, 'mfa-user');
      assert.equal(loaded?.protected_secret, 'kms:ciphertext');
      assert.deepEqual(loaded?.recovery_code_hashes, ['hash-a']);
      await second.close();
    },
  );
});
