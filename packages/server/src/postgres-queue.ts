import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import type { EnqueuedJob, RunnerJob, RunnerQueueLike } from './runner-queue.js';

type StoredJob = {
  id: string;
  payload: unknown;
  enqueued_at: string;
  status: EnqueuedJob['status'];
  leased_until: string | null;
  lease_token: string | null;
  attempts: number;
  max_attempts: number;
  failure_reason: string | null;
};

/** PostgreSQL-backed queue with row locking, visibility leases, and fencing tokens. */
export class PostgresRunnerQueue implements RunnerQueueLike {
  private readonly sql: Sql;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly ready: Promise<void>;

  constructor(dsn: string, opts: { lease_ms?: number; max_attempts?: number } = {}) {
    if (!dsn.trim()) throw new Error('[server/queue] DSN is empty');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.leaseMs = opts.lease_ms ?? 30_000;
    this.maxAttempts = Math.max(1, opts.max_attempts ?? 5);
    this.ready = this.migrate();
  }

  private async q<T>(text: string, values: unknown[] = []): Promise<T[]> {
    const unsafe = this.sql.unsafe as unknown as (
      query: string,
      params: unknown[],
    ) => Promise<unknown>;
    return (await unsafe(text, values)) as T[];
  }

  private async migrate(): Promise<void> {
    const lockKey = "hashtext('aqa_runner_jobs_migration')";
    await this.q(`SELECT pg_advisory_lock(${lockKey})`);
    try {
      await this.q(
        "CREATE TABLE IF NOT EXISTS aqa_runner_jobs (id text PRIMARY KEY, payload jsonb NOT NULL, enqueued_at timestamptz NOT NULL, status text NOT NULL CONSTRAINT aqa_runner_jobs_status_check CHECK (status IN ('queued', 'in_flight', 'done', 'failed')), leased_until timestamptz, lease_token text, attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5, failure_reason text, updated_at timestamptz NOT NULL DEFAULT now())",
      );
      await this.q(
        'ALTER TABLE aqa_runner_jobs DROP CONSTRAINT IF EXISTS aqa_runner_jobs_status_check',
      );
      await this.q(
        "ALTER TABLE aqa_runner_jobs ADD CONSTRAINT aqa_runner_jobs_status_check CHECK (status IN ('queued', 'in_flight', 'done', 'failed'))",
      );
      await this.q(
        'ALTER TABLE aqa_runner_jobs ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5',
      );
      await this.q('ALTER TABLE aqa_runner_jobs ADD COLUMN IF NOT EXISTS failure_reason text');
      await this.q(
        'CREATE INDEX IF NOT EXISTS aqa_runner_jobs_ready_idx ON aqa_runner_jobs (status, enqueued_at, leased_until)',
      );
    } finally {
      await this.q(`SELECT pg_advisory_unlock(${lockKey})`);
    }
  }

  private async wait(): Promise<void> {
    await this.ready;
  }

  private decode<T>(value: unknown): T {
    return (typeof value === 'string' ? JSON.parse(value) : value) as T;
  }

  private map(row: StoredJob): EnqueuedJob {
    return {
      id: row.id,
      payload: this.decode<Record<string, unknown>>(row.payload),
      enqueued_at: row.enqueued_at,
      status: row.status,
      ...(row.leased_until ? { leased_until: row.leased_until } : {}),
      ...(row.lease_token ? { lease_token: row.lease_token } : {}),
      attempts: row.attempts,
      max_attempts: row.max_attempts,
      ...(row.failure_reason ? { failure_reason: row.failure_reason } : {}),
    };
  }

  async enqueue(job: RunnerJob): Promise<EnqueuedJob> {
    await this.wait();
    const rows = await this.q<StoredJob>(
      "INSERT INTO aqa_runner_jobs (id, payload, enqueued_at, status, max_attempts) VALUES ($1, $2::jsonb, $3, 'queued', $4) RETURNING id, payload, enqueued_at, status, leased_until, lease_token, attempts, max_attempts, failure_reason",
      [job.id, JSON.stringify(job.payload), job.enqueued_at, this.maxAttempts],
    );
    const row = rows[0];
    if (!row) throw new Error('[server/queue] enqueue returned no row');
    return this.map(row);
  }

  async dequeue(now = new Date()): Promise<EnqueuedJob | null> {
    await this.wait();
    const token = randomUUID();
    const until = new Date(now.getTime() + this.leaseMs).toISOString();
    const rows = await this.q<StoredJob>(
      `WITH expired AS (
         UPDATE aqa_runner_jobs
         SET status = 'failed', leased_until = NULL, lease_token = NULL,
             failure_reason = 'lease expired after maximum attempts', updated_at = now()
         WHERE status = 'in_flight' AND leased_until < $1 AND attempts >= max_attempts
         RETURNING id
       ), candidate AS (
         SELECT id FROM aqa_runner_jobs
         WHERE status = 'queued' OR (status = 'in_flight' AND leased_until < $1 AND attempts < max_attempts)
         ORDER BY enqueued_at, id
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE aqa_runner_jobs AS j
       SET status = 'in_flight', leased_until = $2, lease_token = $3,
           attempts = j.attempts + 1, updated_at = now()
       FROM candidate WHERE j.id = candidate.id
       RETURNING j.id, j.payload, j.enqueued_at, j.status, j.leased_until, j.lease_token, j.attempts, j.max_attempts, j.failure_reason`,
      [now.toISOString(), until, token],
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  async ack(id: string, leaseToken?: string): Promise<boolean> {
    await this.wait();
    if (!leaseToken) return false;
    const rows = await this.q(
      "UPDATE aqa_runner_jobs SET status = 'done', leased_until = NULL, lease_token = NULL, updated_at = now() WHERE id = $1 AND status = 'in_flight' AND lease_token = $2 RETURNING id",
      [id, leaseToken],
    );
    return rows.length === 1;
  }

  async fail(id: string, leaseToken: string | undefined, reason: string): Promise<boolean> {
    await this.wait();
    if (!leaseToken || !reason.trim()) return false;
    const rows = await this.q(
      "UPDATE aqa_runner_jobs SET status = 'failed', leased_until = NULL, lease_token = NULL, failure_reason = $3, updated_at = now() WHERE id = $1 AND status = 'in_flight' AND lease_token = $2 RETURNING id",
      [id, leaseToken, reason.slice(0, 1000)],
    );
    return rows.length === 1;
  }

  async snapshot(): Promise<EnqueuedJob[]> {
    await this.wait();
    const rows = await this.q<StoredJob>(
      'SELECT id, payload, enqueued_at, status, leased_until, lease_token, attempts, max_attempts, failure_reason FROM aqa_runner_jobs ORDER BY enqueued_at, id',
    );
    return rows.map((row) => this.map(row));
  }

  async close(): Promise<void> {
    await this.wait();
    await this.sql.end({ timeout: 5 });
  }
}
