import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { OidcAdapter } from '../dist/index.js';

const issuer = process.env.AQA_TEST_OIDC_ISSUER?.trim();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`required OIDC provider setting is missing: ${name}`);
  return value;
}

function s256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

/** Full read-only identity-provider journey using an operator-issued code. */
test(
  'live OIDC provider journey proves PKCE exchange, JWKS validation and UserInfo binding',
  { skip: issuer ? false : 'AQA_TEST_OIDC_ISSUER is not configured' },
  async () => {
    if (!issuer) return;

    const clientId = required('AQA_TEST_OIDC_CLIENT_ID');
    const redirectUri = required('AQA_TEST_OIDC_REDIRECT_URI');
    const code = required('AQA_TEST_OIDC_AUTHORIZATION_CODE');
    const nonce = required('AQA_TEST_OIDC_NONCE');
    const verifier = required('AQA_TEST_OIDC_CODE_VERIFIER');
    const clientSecret = required('AQA_TEST_OIDC_CLIENT_SECRET');
    const secretEnv = 'AQA_TEST_OIDC_CLIENT_SECRET';
    process.env[secretEnv] = clientSecret;

    const adapter = new OidcAdapter({
      issuer,
      client_id: clientId,
      client_secret_env: secretEnv,
      redirect_uri: redirectUri,
      allowed_endpoint_origins: process.env.AQA_TEST_OIDC_ALLOWED_ENDPOINT_ORIGINS?.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    });
    const authorizationUrl = await adapter.authorizeUrl(
      'aqa-live-oidc-state',
      s256(verifier),
      nonce,
    );
    const parsedAuthorizationUrl = new URL(authorizationUrl);
    assert.equal(parsedAuthorizationUrl.searchParams.get('client_id'), clientId);
    assert.equal(parsedAuthorizationUrl.searchParams.get('code_challenge'), s256(verifier));
    assert.equal(parsedAuthorizationUrl.searchParams.get('nonce'), nonce);

    const session = await adapter.exchangeCode(code, verifier, nonce);
    assert.ok(session.user.id);
    assert.ok(session.user.email);
    assert.ok(session.user.roles.length > 0);
    assert.ok(session.expires_at > session.issued_at);
    const expectedRole = process.env.AQA_TEST_OIDC_EXPECTED_ROLE?.trim();
    if (expectedRole) assert.ok(session.user.roles.includes(expectedRole as never));
    if (process.env.AQA_TEST_OIDC_EXPECT_MFA === 'true')
      assert.equal(session.user.mfa_verified, true);
  },
);
