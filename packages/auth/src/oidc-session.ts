import { createHash, randomBytes } from 'node:crypto';
import type { OidcAdapter } from './oidc.js';
import type { AuthSession, User } from './types.js';

interface PendingLogin {
  verifier: string;
  expires_at: number;
}
interface StoredSession {
  user: User;
  expires_at: number;
}

export interface OidcLoginStart {
  authorization_url: string;
  state: string;
  pkce_verifier: string;
  expires_at: string;
}

/** Process-local session boundary for the admin's OIDC code flow. */
export class OidcSessionManager {
  private readonly pending = new Map<string, PendingLogin>();
  private readonly sessions = new Map<string, StoredSession>();

  constructor(
    private readonly adapter: OidcAdapter,
    private readonly opts: { loginTtlMs?: number; sessionTtlMs?: number } = {},
  ) {}

  async begin(): Promise<OidcLoginStart> {
    const now = Date.now();
    const ttl = this.opts.loginTtlMs ?? 5 * 60_000;
    const state = randomToken(32);
    const verifier = randomToken(48);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.pending.set(state, { verifier, expires_at: now + ttl });
    return {
      authorization_url: await this.adapter.authorizeUrl(state, challenge),
      state,
      pkce_verifier: verifier,
      expires_at: new Date(now + ttl).toISOString(),
    };
  }

  async complete(state: string, code: string): Promise<{ token: string; session: AuthSession }> {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || pending.expires_at <= Date.now() || !state || !code) {
      throw new Error('[auth/oidc] invalid or expired login state');
    }
    const session = await this.adapter.exchangeCode(code, pending.verifier);
    const token = randomToken(32);
    const configuredTtl = this.opts.sessionTtlMs;
    this.sessions.set(token, {
      user: session.user,
      expires_at:
        configuredTtl === undefined ? Date.parse(session.expires_at) : Date.now() + configuredTtl,
    });
    return { token, session };
  }

  authenticate(headers: Record<string, string>): User | null {
    const cookie = headers.cookie ?? headers.Cookie ?? '';
    const token = cookie.match(/(?:^|;\s*)aqa_session=([^;]+)/)?.[1];
    if (!token) return null;
    const stored = this.sessions.get(token);
    if (!stored) return null;
    if (stored.expires_at <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return stored.user;
  }

  revoke(headers: Record<string, string>): void {
    const cookie = headers.cookie ?? headers.Cookie ?? '';
    const token = cookie.match(/(?:^|;\s*)aqa_session=([^;]+)/)?.[1];
    if (token) this.sessions.delete(token);
  }

  static sessionCookie(token: string, secure = true): string {
    return `aqa_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
  }

  static clearCookie(secure = true): string {
    return `aqa_session=; HttpOnly; Path=/; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0`;
  }
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}
