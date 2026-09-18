import { createPublicKey, verify } from 'node:crypto';
import type { AuthSession } from './types.js';
import { AuthSession as AuthSessionSchema, User } from './types.js';

export interface OidcConfig {
  issuer: string;
  client_id: string;
  client_secret_env: string;
  redirect_uri: string;
  /** Claim containing AQA roles; defaults to `roles`. */
  roles_claim?: string;
  /** Allows deterministic tests without replacing the global fetch. */
  fetch?: typeof fetch;
  /** UserInfo claim containing authentication methods; defaults to `amr`. */
  mfa_claim?: string;
  /** Clock injection for deterministic expiry/rotation tests. */
  now?: () => number;
  /** Maximum accepted clock skew for ID-token time claims. */
  clock_skew_seconds?: number;
}

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
};
type TokenResponse = {
  access_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
};
type JsonWebKeySet = { keys?: Array<Record<string, unknown>> };
type RsaJwk = { kty: 'RSA'; n: string; e: string; [key: string]: unknown };
type UserInfo = {
  sub?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  roles?: unknown;
  amr?: unknown;
  [key: string]: unknown;
};

/**
 * Small provider-neutral OIDC Authorization Code + PKCE client. The provider
 * authenticates the user; AQA still validates the resulting identity against
 * its own strict User/AuthSession schemas and never falls back to an admin.
 */
export class OidcAdapter {
  private discovery?: Discovery;
  private jwks?: { keys: Array<Record<string, unknown>>; expires_at: number };
  private readonly request: typeof fetch;

  constructor(private readonly config: OidcConfig) {
    if (!config.issuer || !config.client_id) {
      throw new Error('[auth/oidc] issuer and client_id are required');
    }
    if (!config.redirect_uri || !config.client_secret_env) {
      throw new Error('[auth/oidc] redirect_uri and client_secret_env are required');
    }
    this.request = config.fetch ?? fetch;
  }

  async authorizeUrl(state: string, codeChallenge?: string, nonce?: string): Promise<string> {
    if (!state.trim()) throw new Error('[auth/oidc] state is required');
    const discovery = await this.getDiscovery();
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('client_id', this.config.client_id);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.config.redirect_uri);
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    if (nonce) url.searchParams.set('nonce', nonce);
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier?: string, nonce?: string): Promise<AuthSession> {
    if (!code.trim()) throw new Error('[auth/oidc] authorization code is required');
    if (!nonce?.trim()) throw new Error('[auth/oidc] OIDC nonce is required');
    const discovery = await this.getDiscovery();
    const secret = process.env[this.config.client_secret_env];
    if (!secret) throw new Error('[auth/oidc] configured client secret is unavailable');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.config.client_id,
      client_secret: secret,
      redirect_uri: this.config.redirect_uri,
    });
    if (codeVerifier) body.set('code_verifier', codeVerifier);
    const token = await this.json<TokenResponse>(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!token.access_token) throw new Error('[auth/oidc] provider returned no access token');
    if (!token.id_token) throw new Error('[auth/oidc] provider returned no ID token');
    const idToken = await this.verifyIdToken(token.id_token, nonce);
    const info = await this.json<UserInfo>(discovery.userinfo_endpoint, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    const id = info.sub;
    const email = info.email;
    if (!id || !email) throw new Error('[auth/oidc] UserInfo lacks required sub/email claims');
    if (id !== idToken.sub) throw new Error('[auth/oidc] UserInfo subject does not match ID token');
    const rawRoles = info[this.config.roles_claim ?? 'roles'] ?? ['viewer'];
    const roles = (Array.isArray(rawRoles) ? rawRoles : [rawRoles]).filter(
      (role): role is 'viewer' | 'developer' | 'maintainer' | 'admin' =>
        role === 'viewer' || role === 'developer' || role === 'maintainer' || role === 'admin',
    );
    if (roles.length === 0) throw new Error('[auth/oidc] no supported AQA role in provider claims');
    const now = Date.now();
    const rawAmr = info[this.config.mfa_claim ?? 'amr'];
    const amr = Array.isArray(rawAmr) ? rawAmr : [rawAmr];
    const mfaVerified = amr.some(
      (method) => method === 'mfa' || method === 'otp' || method === 'webauthn' || method === 'hwk',
    );
    const session = {
      user: User.parse({
        id,
        email,
        display_name: info.name ?? info.preferred_username ?? email,
        roles,
        mfa_verified: mfaVerified,
      }),
      issued_at: new Date(now).toISOString(),
      expires_at: new Date(now + Math.max(1, token.expires_in ?? 3600) * 1000).toISOString(),
    };
    return AuthSessionSchema.parse(session);
  }

  private async getDiscovery(): Promise<Discovery> {
    if (this.discovery) return this.discovery;
    const issuer = this.config.issuer.replace(/\/$/, '');
    const result = await this.json<Partial<Discovery>>(
      `${issuer}/.well-known/openid-configuration`,
      {},
    );
    if (
      !result.issuer ||
      !result.authorization_endpoint ||
      !result.token_endpoint ||
      !result.userinfo_endpoint ||
      !result.jwks_uri
    ) {
      throw new Error('[auth/oidc] discovery document lacks required endpoints');
    }
    this.discovery = {
      issuer: result.issuer,
      authorization_endpoint: result.authorization_endpoint,
      token_endpoint: result.token_endpoint,
      userinfo_endpoint: result.userinfo_endpoint,
      jwks_uri: result.jwks_uri,
    };
    if (this.discovery.issuer.replace(/\/$/, '') !== issuer) {
      throw new Error('[auth/oidc] discovery issuer does not match configured issuer');
    }
    return this.discovery;
  }

  private async verifyIdToken(raw: string, nonce?: string): Promise<{ sub: string }> {
    const parts = raw.split('.');
    if (parts.length !== 3) throw new Error('[auth/oidc] malformed ID token');
    const encodedHeader = parts[0];
    const encodedPayload = parts[1];
    const encodedSignature = parts[2];
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new Error('[auth/oidc] malformed ID token');
    }
    let header: { alg?: unknown; kid?: unknown };
    let payload: {
      iss?: unknown;
      sub?: unknown;
      aud?: unknown;
      azp?: unknown;
      nonce?: unknown;
      exp?: unknown;
      iat?: unknown;
    };
    try {
      header = JSON.parse(
        Buffer.from(encodedHeader, 'base64url').toString('utf8'),
      ) as typeof header;
      payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as typeof payload;
    } catch {
      throw new Error('[auth/oidc] malformed ID token claims');
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
      throw new Error('[auth/oidc] ID token must use RS256 with a key id');
    }
    const discovery = await this.getDiscovery();
    if (payload.iss !== discovery.issuer || typeof payload.sub !== 'string' || !payload.sub) {
      throw new Error('[auth/oidc] ID token issuer or subject is invalid');
    }
    const audience = Array.isArray(payload.aud)
      ? payload.aud.filter((value): value is string => typeof value === 'string')
      : typeof payload.aud === 'string'
        ? [payload.aud]
        : [];
    if (!audience.includes(this.config.client_id)) {
      throw new Error('[auth/oidc] ID token audience is invalid');
    }
    if (audience.length > 1 && payload.azp !== this.config.client_id) {
      throw new Error('[auth/oidc] ID token authorized party is invalid');
    }
    const now = Math.floor((this.config.now?.() ?? Date.now()) / 1000);
    const skew = this.config.clock_skew_seconds ?? 60;
    if (typeof payload.exp !== 'number' || payload.exp <= now - skew) {
      throw new Error('[auth/oidc] ID token is expired');
    }
    if (typeof payload.iat !== 'number' || payload.iat > now + skew) {
      throw new Error('[auth/oidc] ID token issued-at time is invalid');
    }
    if (nonce !== undefined && payload.nonce !== nonce) {
      throw new Error('[auth/oidc] ID token nonce is invalid');
    }
    const signature = Buffer.from(encodedSignature, 'base64url');
    const key = await this.findKey(header.kid);
    if (
      !key ||
      !verify('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`), key, signature)
    ) {
      throw new Error('[auth/oidc] ID token signature is invalid');
    }
    return { sub: payload.sub };
  }

  private async findKey(kid: string) {
    const now = Date.now();
    let keys = this.jwks && this.jwks.expires_at > now ? this.jwks.keys : await this.fetchJwks();
    let jwk = keys.find((candidate) => candidate.kid === kid && candidate.alg === 'RS256');
    if (!jwk) {
      keys = await this.fetchJwks();
      jwk = keys.find((candidate) => candidate.kid === kid && candidate.alg === 'RS256');
    }
    if (!jwk || jwk.kty !== 'RSA') return null;
    try {
      return createPublicKey({ key: jwk as RsaJwk, format: 'jwk' });
    } catch {
      return null;
    }
  }

  private async fetchJwks(): Promise<Array<Record<string, unknown>>> {
    const discovery = await this.getDiscovery();
    const document = await this.json<JsonWebKeySet>(discovery.jwks_uri, {});
    if (!Array.isArray(document.keys))
      throw new Error('[auth/oidc] provider returned invalid JWKS');
    this.jwks = { keys: document.keys, expires_at: Date.now() + 5 * 60_000 };
    return document.keys;
  }

  private async json<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.request(url, { ...init, redirect: 'error' });
    if (!response.ok) throw new Error(`[auth/oidc] provider request failed (${response.status})`);
    try {
      return (await response.json()) as T;
    } catch {
      throw new Error('[auth/oidc] provider returned invalid JSON');
    }
  }
}
