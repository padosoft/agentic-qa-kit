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
}

type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
};
type TokenResponse = { access_token?: string; token_type?: string; expires_in?: number };
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

  async authorizeUrl(state: string, codeChallenge?: string): Promise<string> {
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
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier?: string): Promise<AuthSession> {
    if (!code.trim()) throw new Error('[auth/oidc] authorization code is required');
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
    const info = await this.json<UserInfo>(discovery.userinfo_endpoint, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    const id = info.sub;
    const email = info.email;
    if (!id || !email) throw new Error('[auth/oidc] UserInfo lacks required sub/email claims');
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
    if (!result.authorization_endpoint || !result.token_endpoint || !result.userinfo_endpoint) {
      throw new Error('[auth/oidc] discovery document lacks required endpoints');
    }
    this.discovery = {
      authorization_endpoint: result.authorization_endpoint,
      token_endpoint: result.token_endpoint,
      userinfo_endpoint: result.userinfo_endpoint,
    };
    return this.discovery;
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
