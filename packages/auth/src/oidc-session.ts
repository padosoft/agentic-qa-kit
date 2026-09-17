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

export interface OidcPendingLogin {
  verifier: string;
  expires_at: number;
}

export interface OidcStoredSession {
  user: User;
  expires_at: number;
}

/** Shared backend contract for multi-replica PKCE and cookie sessions. */
export interface OidcSessionStore {
  putPending(state: string, pending: OidcPendingLogin): Promise<void>;
  /** Must consume at most once; PostgreSQL uses DELETE ... RETURNING. */
  consumePending(state: string): Promise<OidcPendingLogin | null>;
  putSession(token: string, session: OidcStoredSession): Promise<void>;
  getSession(token: string): Promise<OidcStoredSession | null>;
  deleteSession(token: string): Promise<void>;
  close?(): Promise<void>;
}

export interface OidcLoginStart {
  authorization_url: string;
  state: string;
  pkce_verifier: string;
  expires_at: string;
}

/** OIDC session boundary; inject OidcSessionStore for multi-replica use. */
export class OidcSessionManager {
  private readonly pending = new Map<string, PendingLogin>();
  private readonly sessions = new Map<string, StoredSession>();

  constructor(
    private readonly adapter: OidcAdapter,
    private readonly opts: {
      loginTtlMs?: number;
      sessionTtlMs?: number;
      store?: OidcSessionStore;
    } = {},
  ) {}

  async begin(): Promise<OidcLoginStart> {
    const now = Date.now();
    const ttl = this.opts.loginTtlMs ?? 5 * 60_000;
    const state = randomToken(32);
    const verifier = randomToken(48);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const pending = { verifier, expires_at: now + ttl };
    if (this.opts.store) await this.opts.store.putPending(state, pending);
    else this.pending.set(state, pending);
    return {
      authorization_url: await this.adapter.authorizeUrl(state, challenge),
      state,
      pkce_verifier: verifier,
      expires_at: new Date(now + ttl).toISOString(),
    };
  }

  async complete(state: string, code: string): Promise<{ token: string; session: AuthSession }> {
    const pending = this.opts.store
      ? await this.opts.store.consumePending(state)
      : this.consumeLocalPending(state);
    if (!pending || pending.expires_at <= Date.now() || !state || !code) {
      throw new Error('[auth/oidc] invalid or expired login state');
    }
    const session = await this.adapter.exchangeCode(code, pending.verifier);
    const token = randomToken(32);
    const configuredTtl = this.opts.sessionTtlMs;
    const stored: StoredSession = {
      user: session.user,
      expires_at:
        configuredTtl === undefined ? Date.parse(session.expires_at) : Date.now() + configuredTtl,
    };
    if (this.opts.store) await this.opts.store.putSession(token, stored);
    else this.sessions.set(token, stored);
    return { token, session };
  }

  authenticate(headers: Record<string, string>): User | null {
    // A synchronous caller cannot safely read an async shared backend. Admin
    // uses authenticateAsync whenever a store is configured; fail closed here.
    if (this.opts.store) return null;
    return this.authenticateLocal(headers);
  }

  async authenticateAsync(headers: Record<string, string>): Promise<User | null> {
    const token = this.cookieToken(headers);
    if (!token) return null;
    if (this.opts.store) {
      const stored = await this.opts.store.getSession(token);
      if (!stored || stored.expires_at <= Date.now()) {
        if (stored) await this.opts.store.deleteSession(token);
        return null;
      }
      return stored.user;
    }
    return this.authenticateLocal(headers);
  }

  private authenticateLocal(headers: Record<string, string>): User | null {
    const token = this.cookieToken(headers);
    if (!token) return null;
    const stored = this.sessions.get(token);
    if (!stored) return null;
    if (stored.expires_at <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return stored.user;
  }

  private cookieToken(headers: Record<string, string>): string | undefined {
    const cookie = headers.cookie ?? headers.Cookie ?? '';
    return cookie.match(/(?:^|;\s*)aqa_session=([^;]+)/)?.[1];
  }

  revoke(headers: Record<string, string>): void {
    if (this.opts.store) return;
    const token = this.cookieToken(headers);
    if (token) this.sessions.delete(token);
  }

  async revokeAsync(headers: Record<string, string>): Promise<void> {
    const token = this.cookieToken(headers);
    if (!token) return;
    if (this.opts.store) await this.opts.store.deleteSession(token);
    else this.sessions.delete(token);
  }

  private consumeLocalPending(state: string): PendingLogin | undefined {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    return pending;
  }

  async close(): Promise<void> {
    await this.opts.store?.close?.();
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
