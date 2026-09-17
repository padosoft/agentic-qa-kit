import postgres from 'postgres';
import type { Sql } from 'postgres';
import type {
  WebAuthnChallenge,
  WebAuthnChallengeStore,
  WebAuthnCredential,
  WebAuthnCredentialStore,
} from './webauthn.js';

type WebAuthnRow = {
  id: string;
  user_id: string;
  challenge: string;
  expires_at: string | Date;
};

type CredentialRow = {
  credential_id: string;
  user_id: string;
  public_key: string;
  sign_count: string | number | bigint;
  counter_supported: boolean;
};

abstract class PostgresWebAuthnBase {
  protected readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string) {
    if (!dsn.trim()) throw new Error('[auth/webauthn] DSN is empty');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.ready = this.migrate();
  }

  protected async query<T>(text: string, values: unknown[] = []): Promise<T[]> {
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
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_webauthn_schema'))");
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_webauthn_challenges (id text PRIMARY KEY, user_id text NOT NULL, challenge text NOT NULL, expires_at timestamptz NOT NULL)',
      );
      await query(
        'CREATE INDEX IF NOT EXISTS aqa_webauthn_challenges_expiry_idx ON aqa_webauthn_challenges (expires_at)',
      );
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_webauthn_credentials (credential_id text PRIMARY KEY, user_id text NOT NULL, public_key text NOT NULL, sign_count bigint NOT NULL DEFAULT 0, counter_supported boolean NOT NULL DEFAULT true)',
      );
      await query(
        'CREATE INDEX IF NOT EXISTS aqa_webauthn_credentials_user_idx ON aqa_webauthn_credentials (user_id)',
      );
    });
  }

  async close(): Promise<void> {
    await this.ready;
    await this.sql.end({ timeout: 5 });
  }
}

export class PostgresWebAuthnChallengeStore
  extends PostgresWebAuthnBase
  implements WebAuthnChallengeStore
{
  async put(challenge: WebAuthnChallenge): Promise<void> {
    await this.query(
      'INSERT INTO aqa_webauthn_challenges (id, user_id, challenge, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
      [challenge.id, challenge.user_id, challenge.challenge, challenge.expires_at],
    );
  }

  async consume(id: string): Promise<WebAuthnChallenge | null> {
    const rows = await this.query<WebAuthnRow>(
      'DELETE FROM aqa_webauthn_challenges WHERE id = $1 RETURNING id, user_id, challenge, expires_at',
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      challenge: row.challenge,
      expires_at: new Date(row.expires_at).toISOString(),
    };
  }
}

export class PostgresWebAuthnCredentialStore
  extends PostgresWebAuthnBase
  implements WebAuthnCredentialStore
{
  async put(credential: WebAuthnCredential): Promise<void> {
    if (!Number.isSafeInteger(credential.sign_count) || credential.sign_count < 0)
      throw new Error('[auth/webauthn] credential sign_count is invalid');
    await this.query(
      'INSERT INTO aqa_webauthn_credentials (credential_id, user_id, public_key, sign_count, counter_supported) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (credential_id) DO UPDATE SET user_id = EXCLUDED.user_id, public_key = EXCLUDED.public_key, counter_supported = EXCLUDED.counter_supported',
      [
        credential.credential_id,
        credential.user_id,
        credential.public_key,
        credential.sign_count,
        credential.counter_supported !== false,
      ],
    );
  }

  async get(userId: string, credentialId: string): Promise<WebAuthnCredential | null> {
    const rows = await this.query<CredentialRow>(
      'SELECT credential_id, user_id, public_key, sign_count, counter_supported FROM aqa_webauthn_credentials WHERE credential_id = $1 AND user_id = $2',
      [credentialId, userId],
    );
    const row = rows[0];
    if (!row) return null;
    const signCount = Number(row.sign_count);
    if (!Number.isSafeInteger(signCount) || signCount < 0) return null;
    return {
      credential_id: row.credential_id,
      user_id: row.user_id,
      public_key: row.public_key,
      sign_count: signCount,
      counter_supported: row.counter_supported,
    };
  }

  async updateSignCount(credentialId: string, signCount: number): Promise<boolean> {
    if (!Number.isSafeInteger(signCount) || signCount < 0) return false;
    const rows = await this.query<{ credential_id: string }>(
      'UPDATE aqa_webauthn_credentials SET sign_count = CASE WHEN counter_supported THEN $2 ELSE sign_count END WHERE credential_id = $1 AND (counter_supported = false OR sign_count < $2) RETURNING credential_id',
      [credentialId, signCount],
    );
    return rows.length === 1;
  }
}
