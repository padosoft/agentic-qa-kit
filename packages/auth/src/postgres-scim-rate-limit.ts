import postgres from 'postgres';
import type { Sql } from 'postgres';
import type { ScimRateLimit, ScimRateLimitOptions } from './scim-rate-limit.js';

/** Atomic shared SCIM limiter for multi-replica deployments. */
export class PostgresScimRateLimiter implements ScimRateLimit {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(dsn: string, options: ScimRateLimitOptions = {}) {
    if (!dsn.trim()) throw new Error('[auth/scim-rate-limit] DSN is empty');
    this.maxRequests = options.max_requests ?? 120;
    this.windowMs = options.window_ms ?? 60_000;
    this.now = options.now ?? Date.now;
    if (![this.maxRequests, this.windowMs].every(Number.isSafeInteger))
      throw new Error('[auth/scim-rate-limit] limits must be integers');
    if (this.maxRequests < 1 || this.windowMs < 1)
      throw new Error('[auth/scim-rate-limit] limits must be positive');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.ready = this.migrate();
  }

  async allow(tenant: string): Promise<boolean> {
    const key = tenant.trim();
    if (!key) return false;
    await this.ready;
    const at = this.now();
    return this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_scim_rate:' || $1))", [key]);
      const rows = (await query(
        'SELECT window_started::text, request_count FROM aqa_scim_rate_limits WHERE tenant = $1',
        [key],
      )) as Array<{ window_started: string; request_count: number }>;
      const row = rows[0];
      const start = row ? Date.parse(row.window_started) : Number.NaN;
      const reset = !row || !Number.isFinite(start) || at - start >= this.windowMs;
      if (reset) {
        await query(
          'INSERT INTO aqa_scim_rate_limits (tenant, window_started, request_count) VALUES ($1, $2::timestamptz, 1) ON CONFLICT (tenant) DO UPDATE SET window_started = EXCLUDED.window_started, request_count = 1',
          [key, new Date(at).toISOString()],
        );
        return true;
      }
      if (row.request_count >= this.maxRequests) return false;
      await query(
        'UPDATE aqa_scim_rate_limits SET request_count = request_count + 1 WHERE tenant = $1',
        [key],
      );
      return true;
    });
  }

  private async migrate(): Promise<void> {
    await this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_scim_rate_schema'))");
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_scim_rate_limits (tenant text PRIMARY KEY, window_started timestamptz NOT NULL, request_count integer NOT NULL)',
      );
    });
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
