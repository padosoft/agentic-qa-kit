import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type OidcAdapter, OidcSessionManager } from '../dist/index.js';

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
});
