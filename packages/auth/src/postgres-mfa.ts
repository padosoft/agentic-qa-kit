import postgres from 'postgres';
import type { Sql } from 'postgres';
import type { MfaCredential, MfaCredentialStore } from './mfa-lifecycle.js';

/** Durable tenant-scoped MFA metadata; protected_secret remains envelope-encrypted by the caller. */
export class PostgresMfaCredentialStore implements MfaCredentialStore {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string) {
    if (!dsn.trim()) throw new Error('[auth/mfa] DSN is empty');
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
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_mfa_credentials'))");
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_mfa_credentials (tenant_id text NOT NULL, user_id text NOT NULL, protected_secret text NOT NULL, recovery_code_hashes jsonb NOT NULL, enabled_at timestamptz NOT NULL, PRIMARY KEY (tenant_id, user_id))',
      );
    });
  }

  async get(tenantId: string, userId: string): Promise<MfaCredential | undefined> {
    const rows = await this.query<{
      tenant_id: string;
      user_id: string;
      protected_secret: string;
      recovery_code_hashes: string[] | string;
      enabled_at: string | Date;
    }>(
      'SELECT tenant_id, user_id, protected_secret, recovery_code_hashes, enabled_at::text FROM aqa_mfa_credentials WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, userId],
    );
    const row = rows[0];
    if (!row) return undefined;
    const hashes =
      typeof row.recovery_code_hashes === 'string'
        ? JSON.parse(row.recovery_code_hashes)
        : row.recovery_code_hashes;
    if (!Array.isArray(hashes) || hashes.some((value) => typeof value !== 'string'))
      throw new Error('[auth/mfa] invalid recovery-code data');
    return {
      tenant_id: row.tenant_id,
      user_id: row.user_id,
      protected_secret: row.protected_secret,
      recovery_code_hashes: hashes,
      enabled_at: toIso(row.enabled_at),
    };
  }

  async put(credential: MfaCredential): Promise<void> {
    await this.query(
      'INSERT INTO aqa_mfa_credentials (tenant_id, user_id, protected_secret, recovery_code_hashes, enabled_at) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz) ON CONFLICT (tenant_id, user_id) DO UPDATE SET protected_secret = EXCLUDED.protected_secret, recovery_code_hashes = EXCLUDED.recovery_code_hashes, enabled_at = EXCLUDED.enabled_at',
      [
        credential.tenant_id,
        credential.user_id,
        credential.protected_secret,
        JSON.stringify(credential.recovery_code_hashes),
        credential.enabled_at,
      ],
    );
  }

  async delete(tenantId: string, userId: string): Promise<void> {
    await this.query('DELETE FROM aqa_mfa_credentials WHERE tenant_id = $1 AND user_id = $2', [
      tenantId,
      userId,
    ]);
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

function toIso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('[auth/mfa] invalid database timestamp');
  return date.toISOString();
}
