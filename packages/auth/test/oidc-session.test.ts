import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type OidcAdapter,
  OidcSessionManager,
  type OidcSessionStore,
  PostgresOidcSessionStore,
} from '../dist/index.js';

const user = {
  id: 'u1',
  email: 'u@example.test',
  display_name: 'User',
  roles: ['viewer' as const],
};

describe('OidcSessionManager', () => {
  it('binds callback code to one-time PKCE state and authenticates cookie sessions', async () => {
    let verifier = '';
    const adapter = {
      authorizeUrl: async (state: string, challenge?: string) => {
        assert.ok(state);
        assert.ok(challenge);
        return `https://idp.test/auth?state=${state}`;
      },
      exchangeCode: async (code: string, actualVerifier?: string) => {
        assert.equal(code, 'code');
        verifier = actualVerifier ?? '';
        return {
          user,
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    } as unknown as OidcAdapter;
    const manager = new OidcSessionManager(adapter);
    const login = await manager.begin();
    const completed = await manager.complete(login.state, 'code');
    assert.equal(verifier, login.pkce_verifier);
    assert.deepEqual(
      manager.authenticate({ cookie: OidcSessionManager.sessionCookie(completed.token) }),
      user,
    );
    await assert.rejects(() => manager.complete(login.state, 'code'), /state/i);
    manager.revoke({ cookie: OidcSessionManager.sessionCookie(completed.token) });
    assert.equal(
      manager.authenticate({ cookie: OidcSessionManager.sessionCookie(completed.token) }),
      null,
    );
  });

  it('supports shared async state across manager instances and consumes PKCE state once', async () => {
    const pending = new Map<string, { verifier: string; expires_at: number }>();
    const sessions = new Map<string, { user: typeof user; expires_at: number }>();
    const store: OidcSessionStore = {
      async putPending(state, value) {
        pending.set(state, value);
      },
      async consumePending(state) {
        const value = pending.get(state);
        pending.delete(state);
        return value && value.expires_at > Date.now() ? value : null;
      },
      async putSession(token, value) {
        sessions.set(token, value as { user: typeof user; expires_at: number });
      },
      async getSession(token) {
        return sessions.get(token) ?? null;
      },
      async deleteSession(token) {
        sessions.delete(token);
      },
    };
    const adapter = {
      authorizeUrl: async (state: string) => `https://idp.test/auth?state=${state}`,
      exchangeCode: async () => ({
        user,
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    } as unknown as OidcAdapter;
    const replicaA = new OidcSessionManager(adapter, { store });
    const replicaB = new OidcSessionManager(adapter, { store });
    const login = await replicaA.begin();
    const completed = await replicaB.complete(login.state, 'code');
    const cookie = { cookie: OidcSessionManager.sessionCookie(completed.token) };
    assert.deepEqual(await replicaA.authenticateAsync(cookie), user);
    assert.deepEqual(await replicaB.authenticateAsync(cookie), user);
    await assert.rejects(() => replicaA.complete(login.state, 'code'), /state/i);
    await replicaB.revokeAsync(cookie);
    assert.equal(await replicaA.authenticateAsync(cookie), null);
    assert.equal(
      replicaA.authenticate(cookie),
      null,
      'sync API must fail closed with async backend',
    );
  });

  it('fails the login before session persistence when MFA is required', async () => {
    const adapter = {
      authorizeUrl: async (state: string) => `https://idp.test/auth?state=${state}`,
      exchangeCode: async () => ({
        user,
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    } as unknown as OidcAdapter;
    const manager = new OidcSessionManager(adapter, { mfaPolicy: { enabled: true } });
    const login = await manager.begin();
    await assert.rejects(() => manager.complete(login.state, 'code'), /multi-factor/);
  });

  it('persists PKCE and sessions across managers with PostgreSQL when configured', async (t) => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      t.skip('AQA_TEST_POSTGRES_DSN is required for the live PostgreSQL contract');
      return;
    }
    const adapter = {
      authorizeUrl: async (state: string) => `https://idp.test/auth?state=${state}`,
      exchangeCode: async () => ({
        user,
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    } as unknown as OidcAdapter;
    const storeA = new PostgresOidcSessionStore(dsn);
    const storeB = new PostgresOidcSessionStore(dsn);
    const replicaA = new OidcSessionManager(adapter, { store: storeA });
    const replicaB = new OidcSessionManager(adapter, { store: storeB });
    try {
      const login = await replicaA.begin();
      const completed = await replicaB.complete(login.state, 'code');
      const cookie = { cookie: OidcSessionManager.sessionCookie(completed.token) };
      assert.deepEqual(await replicaA.authenticateAsync(cookie), user);
      await assert.rejects(() => replicaA.complete(login.state, 'code'), /state/i);
      await replicaB.revokeAsync(cookie);
      assert.equal(await replicaA.authenticateAsync(cookie), null);
    } finally {
      await replicaA.close();
      await replicaB.close();
    }
  });
});
