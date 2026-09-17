import postgres from 'postgres';
import type { Sql } from 'postgres';
import type { ApiIdempotencyOperation, ApiIdempotencyStore } from './api-idempotency.js';
import type { ApiResponse } from './api.js';

interface StoredResponse {
  fingerprint: string;
  state: 'pending' | 'completed';
  response_status: number | null;
  response_body: unknown;
  response_headers: Record<string, string> | null;
  expires_at: string;
}

/** Durable cross-replica idempotency store for the API mutation boundary. */
export class PostgresApiIdempotencyStore implements ApiIdempotencyStore {
  private readonly sql: Sql;
  private readonly ttlMs: number;
  private readonly waitMs: number;
  private readonly ready: Promise<void>;

  constructor(dsn: string, options: { ttl_ms?: number; wait_ms?: number } = {}) {
    if (!dsn.trim()) throw new Error('[server/idempotency] DSN is empty');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.ttlMs = boundedPositive(
      options.ttl_ms ?? 7 * 24 * 60 * 60 * 1_000,
      31 * 24 * 60 * 60 * 1_000,
      'ttl_ms',
    );
    this.waitMs = boundedPositive(options.wait_ms ?? 30_000, 120_000, 'wait_ms');
    this.ready = this.migrate();
  }

  async execute(
    operation: ApiIdempotencyOperation,
    handler: () => Promise<ApiResponse>,
  ): Promise<ApiResponse> {
    await this.ready;
    const claimed = await this.claim(operation);
    if (claimed.kind === 'response') return claimed.response;
    if (claimed.kind === 'wait') return this.waitForCompletion(operation, handler);

    try {
      const response = await handler();
      if (response.status < 500) {
        await this.q(
          `UPDATE aqa_api_idempotency
           SET state = 'completed', response_status = $3, response_body = $4::jsonb,
               response_headers = $5::jsonb, updated_at = now()
           WHERE scope = $1 AND idempotency_key = $2 AND state = 'pending'`,
          [
            operation.scope,
            operation.key,
            response.status,
            JSON.stringify(response.body ?? null),
            JSON.stringify(response.headers ?? null),
          ],
        );
      } else {
        await this.deleteClaim(operation);
      }
      return response;
    } catch (error) {
      await this.deleteClaim(operation);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  private async claim(
    operation: ApiIdempotencyOperation,
  ): Promise<{ kind: 'claimed' } | { kind: 'wait' } | { kind: 'response'; response: ApiResponse }> {
    return this.sql.begin(async (tx) => {
      const rows = await this.qWith<StoredResponse>(
        tx,
        `SELECT fingerprint, state, response_status, response_body, response_headers,
                expires_at::text
         FROM aqa_api_idempotency
         WHERE scope = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [operation.scope, operation.key],
      );
      const prior = rows[0];
      if (prior && new Date(prior.expires_at).getTime() <= Date.now()) {
        await this.qWith(
          tx,
          'DELETE FROM aqa_api_idempotency WHERE scope = $1 AND idempotency_key = $2',
          [operation.scope, operation.key],
        );
      } else if (prior) {
        if (prior.fingerprint !== operation.fingerprint)
          return { kind: 'response', response: conflictResponse() };
        if (prior.state === 'pending') return { kind: 'wait' };
        return { kind: 'response', response: decodeResponse(prior) };
      }
      await this.qWith(
        tx,
        `INSERT INTO aqa_api_idempotency
         (scope, idempotency_key, fingerprint, state, expires_at)
         VALUES ($1, $2, $3, 'pending', now() + ($4 * interval '1 millisecond'))`,
        [operation.scope, operation.key, operation.fingerprint, this.ttlMs],
      );
      return { kind: 'claimed' };
    });
  }

  private async waitForCompletion(
    operation: ApiIdempotencyOperation,
    handler: () => Promise<ApiResponse>,
  ): Promise<ApiResponse> {
    const deadline = Date.now() + this.waitMs;
    while (Date.now() < deadline) {
      const rows = await this.q<StoredResponse>(
        `SELECT fingerprint, state, response_status, response_body, response_headers,
                expires_at::text
         FROM aqa_api_idempotency WHERE scope = $1 AND idempotency_key = $2`,
        [operation.scope, operation.key],
      );
      const row = rows[0];
      if (!row) return this.execute(operation, handler);
      if (row.fingerprint !== operation.fingerprint) return conflictResponse();
      if (row.state === 'completed') return decodeResponse(row);
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())));
    }
    return {
      status: 409,
      body: {
        error: 'idempotency operation is still in progress',
        code: 'IDEMPOTENCY_IN_PROGRESS',
      },
    };
  }

  private async deleteClaim(operation: ApiIdempotencyOperation): Promise<void> {
    await this.q(
      "DELETE FROM aqa_api_idempotency WHERE scope = $1 AND idempotency_key = $2 AND state = 'pending'",
      [operation.scope, operation.key],
    );
  }

  private async migrate(): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.qWith(
        tx,
        "SELECT pg_advisory_xact_lock(hashtext('aqa_api_idempotency_migration'))",
      );
      await this.qWith(
        tx,
        `CREATE TABLE IF NOT EXISTS aqa_api_idempotency (
          scope text NOT NULL,
          idempotency_key text NOT NULL,
          fingerprint text NOT NULL,
          state text NOT NULL CHECK (state IN ('pending', 'completed')),
          response_status integer,
          response_body jsonb,
          response_headers jsonb,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (scope, idempotency_key)
        )`,
      );
      await this.qWith(
        tx,
        'CREATE INDEX IF NOT EXISTS aqa_api_idempotency_expiry_idx ON aqa_api_idempotency (expires_at)',
      );
    });
  }

  private async q<T>(text: string, values: unknown[] = []): Promise<T[]> {
    return this.qWith<T>(this.sql, text, values);
  }

  private async qWith<T>(client: unknown, text: string, values: unknown[] = []): Promise<T[]> {
    const unsafe = (
      client as { unsafe: (query: string, params?: unknown[]) => unknown }
    ).unsafe.bind(client) as (query: string, params?: unknown[]) => Promise<unknown>;
    return (await unsafe(text, values)) as T[];
  }
}

function decodeResponse(row: StoredResponse): ApiResponse {
  return {
    status: row.response_status ?? 500,
    body: row.response_body,
    ...(row.response_headers ? { headers: row.response_headers } : {}),
  };
}

function conflictResponse(): ApiResponse {
  return {
    status: 409,
    body: {
      error: 'idempotency key was reused with a different request',
      code: 'IDEMPOTENCY_CONFLICT',
    },
  };
}

function boundedPositive(value: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  return value;
}
