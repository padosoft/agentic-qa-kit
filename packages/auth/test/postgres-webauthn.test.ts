import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PostgresWebAuthnChallengeStore, PostgresWebAuthnCredentialStore } from '../dist/index.js';

describe('Postgres WebAuthn stores', () => {
  it('consumes challenges once and updates counters atomically across store instances', async () => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      console.warn('SKIP: AQA_TEST_POSTGRES_DSN is required for the live PostgreSQL contract');
      return;
    }
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const challengesA = new PostgresWebAuthnChallengeStore(dsn);
    const challengesB = new PostgresWebAuthnChallengeStore(dsn);
    const credentialsA = new PostgresWebAuthnCredentialStore(dsn);
    const credentialsB = new PostgresWebAuthnCredentialStore(dsn);
    try {
      await challengesA.put({
        id: `challenge-${suffix}`,
        user_id: `user-${suffix}`,
        challenge: 'random-challenge',
        expires_at: '2030-01-01T00:00:00.000Z',
      });
      assert.equal(
        (await challengesA.consume(`challenge-${suffix}`))?.challenge,
        'random-challenge',
      );
      assert.equal(await challengesB.consume(`challenge-${suffix}`), null);

      await credentialsA.put({
        credential_id: `credential-${suffix}`,
        user_id: `user-${suffix}`,
        public_key: 'public-key',
        sign_count: 0,
        counter_supported: true,
      });
      const [first, second] = await Promise.all([
        credentialsA.updateSignCount(`credential-${suffix}`, 3),
        credentialsB.updateSignCount(`credential-${suffix}`, 3),
      ]);
      assert.equal([first, second].filter(Boolean).length, 1);
      assert.equal(
        (await credentialsB.get(`user-${suffix}`, `credential-${suffix}`))?.sign_count,
        3,
      );
    } finally {
      await challengesA.close();
      await challengesB.close();
      await credentialsA.close();
      await credentialsB.close();
    }
  });
});
