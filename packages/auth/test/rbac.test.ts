import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OidcAdapter, allows, enforceMfa, mfaRequired } from '../dist/index.js';

const viewer = { id: '1', email: 'v@x.test', display_name: 'V', roles: ['viewer' as const] };
const dev = { id: '2', email: 'd@x.test', display_name: 'D', roles: ['developer' as const] };
const admin = { id: '3', email: 'a@x.test', display_name: 'A', roles: ['admin' as const] };

describe('allows', () => {
  it('viewer can read runs but cannot create them', () => {
    assert.equal(allows(viewer, 'runs:read'), true);
    assert.equal(allows(viewer, 'runs:create'), false);
  });
  it('developer can create runs and edit findings', () => {
    assert.equal(allows(dev, 'runs:create'), true);
    assert.equal(allows(dev, 'findings:edit'), true);
    assert.equal(allows(dev, 'profiles:edit'), false);
  });
  it('admin holds every permission via admin:everything', () => {
    assert.equal(allows(admin, 'settings:edit'), true);
    assert.equal(allows(admin, 'packs:install'), true);
    assert.equal(allows(admin, 'audit:read'), true);
  });
});

describe('MFA policy', () => {
  it('requires an asserted factor only for configured roles', () => {
    assert.equal(mfaRequired(viewer, { enabled: true, required_roles: ['admin'] }), false);
    assert.throws(() => enforceMfa(admin, { enabled: true }), /multi-factor/);
    assert.deepEqual(enforceMfa({ ...admin, mfa_verified: true }, { enabled: true }), {
      ...admin,
      mfa_verified: true,
    });
  });
});

describe('OidcAdapter', () => {
  it('refuses empty issuer / client_id at construction', () => {
    assert.throws(
      () =>
        new OidcAdapter({
          issuer: '',
          client_id: '',
          client_secret_env: '',
          redirect_uri: '',
        }),
    );
  });
  it('builds an authorization URL from provider discovery and PKCE', async () => {
    const a = new OidcAdapter({
      issuer: 'https://idp.example',
      client_id: 'aqa',
      client_secret_env: 'OIDC_SECRET',
      redirect_uri: 'https://aqa.example/callback',
      fetch: async () =>
        new Response(
          JSON.stringify({
            authorization_endpoint: 'https://idp.example/authorize',
            token_endpoint: 'https://idp.example/token',
            userinfo_endpoint: 'https://idp.example/userinfo',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    const url = new URL(await a.authorizeUrl('state-x', 'challenge-x'));
    assert.equal(url.searchParams.get('client_id'), 'aqa');
    assert.equal(url.searchParams.get('state'), 'state-x');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  });

  it('exchanges a code through token + UserInfo and maps supported roles', async () => {
    process.env.OIDC_TEST_VALUE = 'test-only-value';
    const calls: string[] = [];
    const a = new OidcAdapter({
      issuer: 'https://idp.example',
      client_id: 'aqa',
      client_secret_env: 'OIDC_TEST_VALUE',
      redirect_uri: 'https://aqa.example/callback',
      fetch: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('openid-configuration'))
          return new Response(
            JSON.stringify({
              authorization_endpoint: 'https://idp.example/authorize',
              token_endpoint: 'https://idp.example/token',
              userinfo_endpoint: 'https://idp.example/userinfo',
            }),
            { status: 200 },
          );
        if (url.endsWith('/token'))
          return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 60 }), {
            status: 200,
          });
        return new Response(
          JSON.stringify({
            sub: 'user-1',
            email: 'user@example.test',
            name: 'User One',
            roles: ['developer'],
          }),
          { status: 200 },
        );
      },
    });
    const session = await a.exchangeCode('code-x', 'verifier-x');
    assert.equal(session.user.id, 'user-1');
    assert.deepEqual(session.user.roles, ['developer']);
    assert.equal(calls.length, 3);
    process.env.OIDC_TEST_VALUE = undefined;
  });

  it('fails closed when the provider has no supported role', async () => {
    process.env.OIDC_TEST_VALUE = 'test-only-value';
    const a = new OidcAdapter({
      issuer: 'https://idp.example',
      client_id: 'aqa',
      client_secret_env: 'OIDC_TEST_VALUE',
      redirect_uri: 'https://aqa.example/callback',
      fetch: async (input) =>
        String(input).endsWith('openid-configuration')
          ? new Response(
              JSON.stringify({
                authorization_endpoint: 'https://idp.example/a',
                token_endpoint: 'https://idp.example/t',
                userinfo_endpoint: 'https://idp.example/u',
              }),
              { status: 200 },
            )
          : String(input).endsWith('/t')
            ? new Response(JSON.stringify({ access_token: 'x' }), { status: 200 })
            : new Response(
                JSON.stringify({ sub: 'user-1', email: 'user@example.test', roles: ['owner'] }),
                { status: 200 },
              ),
    });
    await assert.rejects(() => a.exchangeCode('code-x'), /no supported AQA role/);
    process.env.OIDC_TEST_VALUE = undefined;
  });
});
