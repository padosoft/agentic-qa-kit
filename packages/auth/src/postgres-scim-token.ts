import postgres from 'postgres';
import type { Sql } from 'postgres';
import type { ScimTokenRecord, ScimTokenStore } from './scim-token.js';

/** Durable hash-only SCIM token records for multi-replica deployments. */
export class PostgresScimTokenStore implements ScimTokenStore {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string) {
    if (!dsn.trim()) throw new Error('[auth/scim-token] DSN is empty');
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
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_scim_tokens'))");
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_scim_tokens (id text PRIMARY KEY, tenant text NOT NULL, token_hash text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz NULL)',
      );
      await query(
        'CREATE INDEX IF NOT EXISTS aqa_scim_tokens_tenant_idx ON aqa_scim_tokens (tenant, expires_at)',
      );
    });
  }

  async get(id: string): Promise<ScimTokenRecord | null> {
    const rows = await this.query<{
      id: string;
      tenant: string;
      token_hash: string;
      created_at: string | Date;
      expires_at: string | Date;
      revoked_at: string | Date | null;
    }>(
      'SELECT id, tenant, token_hash, created_at::text, expires_at::text, revoked_at::text FROM aqa_scim_tokens WHERE id = $1 AND expires_at > now() OR id = $1 AND revoked_at IS NOT NULL',
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tenant: row.tenant,
      token_hash: row.token_hash,
      created_at: toIso(row.created_at),
      expires_at: toIso(row.expires_at),
      ...(row.revoked_at ? { revoked_at: toIso(row.revoked_at) } : {}),
    };
  }

  async put(record: ScimTokenRecord): Promise<void> {
    await this.query(
      'DELETE FROM aqa_scim_tokens WHERE expires_at <= now() AND revoked_at IS NULL',
    );
    await this.query(
      'INSERT INTO aqa_scim_tokens (id, tenant, token_hash, created_at, expires_at, revoked_at) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz) ON CONFLICT (id) DO UPDATE SET tenant = EXCLUDED.tenant, token_hash = EXCLUDED.token_hash, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at, revoked_at = EXCLUDED.revoked_at',
      [
        record.id,
        record.tenant,
        record.token_hash,
        record.created_at,
        record.expires_at,
        record.revoked_at ?? null,
      ],
    );
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

function toIso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error('[auth/scim-token] invalid database timestamp');
  return date.toISOString();
}
