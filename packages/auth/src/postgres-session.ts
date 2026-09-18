import postgres from 'postgres';
import type { Sql } from 'postgres';
import type { OidcPendingLogin, OidcSessionStore, OidcStoredSession } from './oidc-session.js';
import type { User } from './types.js';

/** PostgreSQL-backed shared OIDC PKCE/session state for HA admin replicas. */
export class PostgresOidcSessionStore implements OidcSessionStore {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string) {
    if (!dsn.trim()) throw new Error('[auth/oidc-session] DSN is empty');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.ready = this.migrate();
  }

  private async query<T>(text: string, values: unknown[] = []): Promise<T[]> {
    await this.ready;
    const unsafe = this.sql.unsafe as unknown as (
      query: string,
      params: unknown[],
    ) => Promise<unknown>;
    return (await unsafe(text, values)) as T[];
  }

  private async migrate(): Promise<void> {
    await this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_oidc_sessions'))");
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_oidc_pending (state text PRIMARY KEY, verifier text NOT NULL, expires_at timestamptz NOT NULL)',
      );
      await query('ALTER TABLE aqa_oidc_pending ADD COLUMN IF NOT EXISTS nonce text');
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_oidc_sessions (token text PRIMARY KEY, user_json jsonb NOT NULL, expires_at timestamptz NOT NULL)',
      );
      await query(
        'CREATE INDEX IF NOT EXISTS aqa_oidc_pending_expiry_idx ON aqa_oidc_pending (expires_at)',
      );
      await query(
        'CREATE INDEX IF NOT EXISTS aqa_oidc_sessions_expiry_idx ON aqa_oidc_sessions (expires_at)',
      );
    });
  }

  async putPending(state: string, pending: OidcPendingLogin): Promise<void> {
    await this.query('DELETE FROM aqa_oidc_pending WHERE expires_at <= now()');
    await this.query(
      'INSERT INTO aqa_oidc_pending (state, verifier, nonce, expires_at) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0)) ON CONFLICT (state) DO UPDATE SET verifier = EXCLUDED.verifier, nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at',
      [state, pending.verifier, pending.nonce, pending.expires_at],
    );
  }

  async consumePending(state: string): Promise<OidcPendingLogin | null> {
    const rows = await this.query<{ verifier: string; nonce: string; expires_at: string }>(
      'DELETE FROM aqa_oidc_pending WHERE state = $1 AND nonce IS NOT NULL AND expires_at > now() RETURNING verifier, nonce, extract(epoch from expires_at) * 1000 AS expires_at',
      [state],
    );
    const row = rows[0];
    return row
      ? { verifier: row.verifier, nonce: row.nonce, expires_at: Number(row.expires_at) }
      : null;
  }

  async putSession(token: string, session: OidcStoredSession): Promise<void> {
    await this.query('DELETE FROM aqa_oidc_sessions WHERE expires_at <= now()');
    await this.query(
      'INSERT INTO aqa_oidc_sessions (token, user_json, expires_at) VALUES ($1, $2::jsonb, to_timestamp($3 / 1000.0)) ON CONFLICT (token) DO UPDATE SET user_json = EXCLUDED.user_json, expires_at = EXCLUDED.expires_at',
      [token, JSON.stringify(session.user), session.expires_at],
    );
  }

  async getSession(token: string): Promise<OidcStoredSession | null> {
    const rows = await this.query<{ user_json: unknown; expires_at: string }>(
      'SELECT user_json, extract(epoch from expires_at) * 1000 AS expires_at FROM aqa_oidc_sessions WHERE token = $1 AND expires_at > now()',
      [token],
    );
    const row = rows[0];
    if (!row) return null;
    const user = (
      typeof row.user_json === 'string' ? JSON.parse(row.user_json) : row.user_json
    ) as User;
    return { user, expires_at: Number(row.expires_at) };
  }

  async deleteSession(token: string): Promise<void> {
    await this.query('DELETE FROM aqa_oidc_sessions WHERE token = $1', [token]);
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
