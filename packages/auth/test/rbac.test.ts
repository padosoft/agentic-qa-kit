import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  OidcAdapter,
  SamlLoginBoundary,
  SamlValidationError,
  ScimProvisioner,
  ScimRateLimiter,
  ScimTokenManager,
  ScimValidationError,
  allows,
  enforceMfa,
  mfaRequired,
  verifyTotp,
} from '../dist/index.js';

const viewer = { id: '1', email: 'v@x.test', display_name: 'V', roles: ['viewer' as const] };
const dev = { id: '2', email: 'd@x.test', display_name: 'D', roles: ['developer' as const] };
const admin = { id: '3', email: 'a@x.test', display_name: 'A', roles: ['admin' as const] };
const oidcTestKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });

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

  it('verifies RFC 6238 TOTP vectors with bounded clock skew', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    assert.equal(
      verifyTotp({ secret_base32: secret, code: '94287082', now_ms: 59_000, digits: 8, window: 0 }),
      true,
    );
    assert.equal(
      verifyTotp({ secret_base32: secret, code: '94287081', now_ms: 59_000, digits: 8, window: 0 }),
      false,
    );
    assert.equal(
      verifyTotp({ secret_base32: secret, code: '94287082', now_ms: 89_000, digits: 8, window: 1 }),
      true,
    );
    assert.equal(verifyTotp({ secret_base32: secret, code: 'bad', now_ms: 59_000 }), false);
  });
});

describe('SCIM rate limiting', () => {
  it('bounds requests per tenant and resets after the window', () => {
    let now = 1_000;
    const limiter = new ScimRateLimiter({ max_requests: 2, window_ms: 100, now: () => now });
    assert.equal(limiter.allow('org-a'), true);
    assert.equal(limiter.allow('org-a'), true);
    assert.equal(limiter.allow('org-a'), false);
    assert.equal(limiter.allow('org-b'), true);
    now += 100;
    assert.equal(limiter.allow('org-a'), true);
  });
});

describe('SCIM provisioning', () => {
  it('keeps CRUD operations tenant-bound and applies idempotent deactivation', async () => {
    const users = new Map<
      string,
      {
        id: string;
        tenant: string;
        active: boolean;
        user_name: string;
        email: string;
        display_name: string;
        roles: ['viewer'];
        updated_at: string;
      }
    >();
    const directory = {
      async get(tenant: string, id: string) {
        const user = users.get(id);
        return user?.tenant === tenant ? user : null;
      },
      async list(tenant: string, filter?: string) {
        return [...users.values()].filter(
          (user) => user.tenant === tenant && (!filter || filter.includes(user.user_name)),
        );
      },
      async put(user: typeof users extends Map<string, infer V> ? V : never) {
        users.set(user.id, user);
      },
      async remove(tenant: string, id: string) {
        const user = users.get(id);
        if (user?.tenant === tenant) users.delete(id);
      },
    };
    const scim = new ScimProvisioner(directory, 'org-a');
    const created = await scim.create({
      userName: 'alice',
      emails: [{ value: 'alice@example.test', primary: true }],
    });
    assert.equal(created.tenant, 'org-a');
    await scim.patch(created.id, [{ op: 'replace', path: 'active', value: false }]);
    assert.equal((await scim.get(created.id)).active, false);
    await scim.deactivate(created.id);
    await assert.rejects(
      () => new ScimProvisioner(directory, 'org-b').get(created.id),
      ScimValidationError,
    );
  });

  it('rejects duplicate names and invalid patch paths', async () => {
    const entries = new Map<string, never>();
    const directory = {
      async get() {
        return null;
      },
      async list() {
        return [];
      },
      async put() {},
      async remove() {},
    };
    const scim = new ScimProvisioner(directory, 'org-a');
    await assert.rejects(() => scim.create({ userName: '', emails: [] }), /userName/);
    void entries;
  });
});

describe('SCIM bearer token lifecycle', () => {
  it('stores only hashes, verifies tenant-bound tokens, and rotates with audit events', async () => {
    const records = new Map<string, import('../dist/index.js').ScimTokenRecord>();
    const events: Array<{ action: string; reason?: string }> = [];
    let now = new Date('2026-01-01T00:00:00.000Z');
    const manager = new ScimTokenManager(
      {
        get: async (id) => records.get(id) ?? null,
        put: async (record) => void records.set(record.id, record),
      },
      (event) =>
        void events.push({
          action: event.action,
          ...(event.reason ? { reason: event.reason } : {}),
        }),
      () => now,
    );

    const first = await manager.issue('org-a', 1_000);
    const stored = records.get(first.id);
    assert.ok(stored);
    assert.notEqual(stored.token_hash, first.token);
    assert.equal(await manager.verify('org-a', first.id, first.token), true);
    assert.equal(await manager.verify('org-b', first.id, first.token), false);
    assert.equal(await manager.verify('org-a', first.id, 'wrong-token'), false);

    const next = await manager.rotate('org-a', first.id, 1_000);
    assert.equal(await manager.verify('org-a', first.id, first.token), false);
    assert.equal(await manager.verify('org-a', next.id, next.token), true);
    now = new Date('2026-01-01T00:00:02.000Z');
    assert.equal(await manager.verify('org-a', next.id, next.token), false);
    assert.deepEqual(
      events.map((event) => event.action),
      ['issued', 'rejected', 'rejected', 'revoked', 'issued', 'rotated', 'rejected', 'rejected'],
    );
  });

  it('verifies the explicit SCIM bearer transport form without exposing the secret', async () => {
    const records = new Map<string, import('../dist/index.js').ScimTokenRecord>();
    const manager = new ScimTokenManager({
      get: async (id) => records.get(id) ?? null,
      put: async (record) => void records.set(record.id, record),
    });
    const issued = await manager.issue('org-a');
    assert.equal(await manager.verifyBearer('org-a', `Bearer ${issued.id}.${issued.token}`), true);
    assert.equal(await manager.verifyBearer('org-a', `Basic ${issued.id}.${issued.token}`), false);
    assert.equal(await manager.verifyBearer('org-a', 'Bearer malformed'), false);
  });

  it('uses an atomic store rotation when the durable contract is available', async () => {
    const records = new Map<string, import('../dist/index.js').ScimTokenRecord>();
    const actions: string[] = [];
    const manager = new ScimTokenManager(
      {
        get: async (id) => records.get(id) ?? null,
        put: async (record) => void records.set(record.id, record),
        rotate: async (tenant, tokenId, replacement) => {
          const current = records.get(tokenId);
          if (!current || current.tenant !== tenant || current.revoked_at) return false;
          records.set(tokenId, { ...current, revoked_at: '2026-01-01T00:00:00.000Z' });
          records.set(replacement.id, replacement);
          return true;
        },
      },
      (event) => void actions.push(event.action),
    );

    const first = await manager.issue('org-a');
    const next = await manager.rotate('org-a', first.id);
    assert.equal(await manager.verify('org-a', first.id, first.token), false);
    assert.equal(await manager.verify('org-a', next.id, next.token), true);
    assert.deepEqual(actions, ['issued', 'rotated', 'rejected']);
  });
});

describe('SAML login boundary', () => {
  it('validates audience, time window and atomic replay claim', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const claims = {
      assertion_id: 'assertion-1',
      issuer: 'https://idp.example/saml',
      audience: 'https://aqa.example/saml/metadata',
      subject: 'user-1',
      email: 'user@example.test',
      roles: ['developer', 'unknown-role'],
      issued_at: '2025-12-31T23:59:00.000Z',
      expires_at: '2026-01-01T00:05:00.000Z',
    };
    const claimed = new Set<string>();
    const boundary = new SamlLoginBoundary({
      issuer: claims.issuer,
      audience: claims.audience,
      verifySignature: async () => claims,
      replayGuard: {
        claim: async (id) => {
          if (claimed.has(id)) return false;
          claimed.add(id);
          return true;
        },
      },
      now: () => now,
    });
    const principal = await boundary.authenticate('<signed-assertion/>');
    assert.deepEqual(principal.roles, ['developer']);
    await assert.rejects(() => boundary.authenticate('<signed-assertion/>'), SamlValidationError);
    now = new Date('2026-01-01T00:06:00.000Z');
    const expired = new SamlLoginBoundary({
      issuer: claims.issuer,
      audience: claims.audience,
      verifySignature: async () => ({ ...claims, assertion_id: 'assertion-expired' }),
      replayGuard: { claim: async () => true },
      now: () => now,
    });
    await assert.rejects(() => expired.authenticate('<signed-assertion/>'), /expired/);
  });

  it('fails closed on issuer, audience and malformed claim errors', async () => {
    const base = {
      assertion_id: 'assertion-2',
      issuer: 'issuer',
      audience: 'audience',
      subject: 'user-2',
      email: 'user2@example.test',
      issued_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2026-01-01T00:05:00.000Z',
    };
    const make = (value: unknown) =>
      new SamlLoginBoundary({
        issuer: 'issuer',
        audience: 'audience',
        verifySignature: async () => value,
        replayGuard: { claim: async () => true },
        now: () => new Date('2026-01-01T00:01:00.000Z'),
      });
    await assert.rejects(() => make({ ...base, issuer: 'other' }).authenticate('x'), /issuer/);
    await assert.rejects(() => make({ ...base, audience: 'other' }).authenticate('x'), /audience/);
    await assert.rejects(() => make({ ...base, email: 'bad' }).authenticate('x'), /email/);
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
            issuer: 'https://idp.example',
            jwks_uri: 'https://idp.example/jwks',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    const url = new URL(await a.authorizeUrl('state-x', 'challenge-x'));
    assert.equal(url.searchParams.get('client_id'), 'aqa');
    assert.equal(url.searchParams.get('state'), 'state-x');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  });

  it('rejects discovered endpoints outside the explicit HTTPS origin allowlist', async () => {
    const adapter = new OidcAdapter({
      issuer: 'https://idp.example',
      client_id: 'aqa',
      client_secret_env: 'OIDC_SECRET',
      redirect_uri: 'https://aqa.example/callback',
      fetch: async () =>
        new Response(
          JSON.stringify({
            authorization_endpoint: 'https://idp.example/authorize',
            token_endpoint: 'https://attacker.example/token',
            userinfo_endpoint: 'https://idp.example/userinfo',
            issuer: 'https://idp.example',
            jwks_uri: 'https://idp.example/jwks',
          }),
          { status: 200 },
        ),
    });
    await assert.rejects(() => adapter.authorizeUrl('state-x'), /not an allowed HTTPS origin/);
  });

  it('allows explicitly configured HTTPS endpoint origins', async () => {
    const adapter = new OidcAdapter({
      issuer: 'https://idp.example',
      allowed_endpoint_origins: ['https://login.example'],
      client_id: 'aqa',
      client_secret_env: 'OIDC_SECRET',
      redirect_uri: 'https://aqa.example/callback',
      fetch: async () =>
        new Response(
          JSON.stringify({
            authorization_endpoint: 'https://login.example/authorize',
            token_endpoint: 'https://login.example/token',
            userinfo_endpoint: 'https://login.example/userinfo',
            issuer: 'https://idp.example',
            jwks_uri: 'https://login.example/jwks',
          }),
          { status: 200 },
        ),
    });
    const url = new URL(await adapter.authorizeUrl('state-x'));
    assert.equal(url.origin, 'https://login.example');
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
              issuer: 'https://idp.example',
              jwks_uri: 'https://idp.example/jwks',
            }),
            { status: 200 },
          );
        if (url.endsWith('/token'))
          return new Response(
            JSON.stringify({
              access_token: 'access-token',
              id_token: makeIdToken('key-1', 'https://idp.example', 'aqa', 'nonce-x'),
              expires_in: 60,
            }),
            {
              status: 200,
            },
          );
        if (url.endsWith('/jwks'))
          return new Response(JSON.stringify({ keys: [jwk(oidcTestKeyPair.publicKey, 'key-1')] }));
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
    const session = await a.exchangeCode('code-x', 'verifier-x', 'nonce-x');
    assert.equal(session.user.id, 'user-1');
    assert.deepEqual(session.user.roles, ['developer']);
    assert.equal(calls.length, 4);
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
                issuer: 'https://idp.example',
                jwks_uri: 'https://idp.example/jwks',
              }),
              { status: 200 },
            )
          : String(input).endsWith('/t')
            ? new Response(
                JSON.stringify({
                  access_token: 'x',
                  id_token: makeIdToken('key-1', 'https://idp.example', 'aqa', 'nonce-x'),
                }),
                { status: 200 },
              )
            : String(input).endsWith('/jwks')
              ? new Response(JSON.stringify({ keys: [jwk(oidcTestKeyPair.publicKey, 'key-1')] }))
              : new Response(
                  JSON.stringify({ sub: 'user-1', email: 'user@example.test', roles: ['owner'] }),
                  { status: 200 },
                ),
    });
    await assert.rejects(
      () => a.exchangeCode('code-x', undefined, 'nonce-x'),
      /no supported AQA role/,
    );
    process.env.OIDC_TEST_VALUE = undefined;
  });

  it('validates the signed ID token and refreshes JWKS after key rotation', async () => {
    const first = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const second = generateKeyPairSync('rsa', { modulusLength: 2048 });
    let jwksCalls = 0;
    let active = first;
    process.env.OIDC_TEST_VALUE = 'test-only-value';
    const a = new OidcAdapter({
      issuer: 'https://idp.example',
      client_id: 'aqa',
      client_secret_env: 'OIDC_TEST_VALUE',
      redirect_uri: 'https://aqa.example/callback',
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith('openid-configuration'))
          return new Response(
            JSON.stringify({
              issuer: 'https://idp.example',
              authorization_endpoint: 'https://idp.example/authorize',
              token_endpoint: 'https://idp.example/token',
              userinfo_endpoint: 'https://idp.example/userinfo',
              jwks_uri: 'https://idp.example/jwks',
            }),
          );
        if (url.endsWith('/jwks')) {
          jwksCalls += 1;
          return new Response(
            JSON.stringify({ keys: [jwk(active.publicKey, active === first ? 'key-1' : 'key-2')] }),
          );
        }
        if (url.endsWith('/token'))
          return new Response(
            JSON.stringify({
              access_token: 'access-token',
              id_token: makeIdToken(
                active === first ? 'key-1' : 'key-2',
                'https://idp.example',
                'aqa',
                'nonce-x',
                active.privateKey,
              ),
            }),
          );
        return new Response(
          JSON.stringify({ sub: 'user-1', email: 'user@example.test', roles: ['viewer'] }),
        );
      },
    });
    await a.exchangeCode('code-x', undefined, 'nonce-x');
    active = second;
    await a.exchangeCode('code-x', undefined, 'nonce-x');
    assert.equal(jwksCalls, 2, 'unknown kid must force one JWKS refresh for rotation');
    await assert.rejects(() => a.exchangeCode('code-x', undefined, 'wrong-nonce'), /nonce/);
    process.env.OIDC_TEST_VALUE = undefined;
  });
});

function makeIdToken(
  kid: string,
  issuer: string,
  audience: string,
  nonce: string,
  privateKey?: ReturnType<typeof generateKeyPairSync>['privateKey'],
): string {
  const key = privateKey ?? oidcTestKeyPair.privateKey;
  const header = base64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: issuer,
      sub: 'user-1',
      aud: audience,
      nonce,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    }),
  );
  return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url')}`;
}

function jwk(key: ReturnType<typeof generateKeyPairSync>['publicKey'], kid: string) {
  return { ...(key.export({ format: 'jwk' }) as JsonWebKey), kid, alg: 'RS256', use: 'sig' };
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}
