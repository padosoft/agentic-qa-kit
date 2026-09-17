import postgres from 'postgres';
import type { Sql } from 'postgres';
import type { SamlReplayGuard } from './saml.js';

/** Durable atomic replay claim store for signed SAML assertions. */
export class PostgresSamlReplayGuard implements SamlReplayGuard {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string) {
    if (!dsn.trim()) throw new Error('[auth/saml] DSN is empty');
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
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_saml_replay'))");
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_saml_replay (assertion_id text PRIMARY KEY, expires_at timestamptz NOT NULL, claimed_at timestamptz NOT NULL DEFAULT now())',
      );
      await query(
        'CREATE INDEX IF NOT EXISTS aqa_saml_replay_expiry_idx ON aqa_saml_replay (expires_at)',
      );
    });
  }

  async claim(assertionId: string, expiresAt: string): Promise<boolean> {
    if (!assertionId.trim()) throw new Error('[auth/saml] assertion id is required');
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry)) throw new Error('[auth/saml] replay expiry is invalid');
    const rows = await this.query<{ assertion_id: string }>(
      'WITH cleanup AS (DELETE FROM aqa_saml_replay WHERE expires_at <= now()) INSERT INTO aqa_saml_replay (assertion_id, expires_at) VALUES ($1, $2::timestamptz) ON CONFLICT (assertion_id) DO NOTHING RETURNING assertion_id',
      [assertionId, new Date(expiry).toISOString()],
    );
    return rows.length === 1;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
