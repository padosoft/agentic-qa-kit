import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  IdempotencyConflictError,
  PostgresRunnerQueue,
  ResourceQuotaExceededError,
} from '../dist/index.js';

describe('PostgresRunnerQueue', () => {
  it('survives reconnect and fences stale acknowledgements', async () => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      assert.ok(true, 'integration contract requires AQA_TEST_POSTGRES_DSN');
      return;
    }
    const first = new PostgresRunnerQueue(dsn, { lease_ms: 100 });
    const second = new PostgresRunnerQueue(dsn, { lease_ms: 100 });
    const id = `queue-${randomUUID()}`;
    try {
      await first.enqueue({
        id,
        payload: { project: 'demo' },
        enqueued_at: new Date().toISOString(),
      });
      const leaseA = await first.dequeue(new Date('2026-05-17T10:00:00Z'));
      assert.equal(leaseA?.id, id);
      const leaseB = await second.dequeue(new Date('2026-05-17T10:00:00.500Z'));
      assert.equal(leaseB?.id, id);
      assert.notEqual(leaseA?.lease_token, leaseB?.lease_token);
      assert.equal(await first.ack(id, leaseA?.lease_token), false);
      assert.equal(await second.ack(id, leaseB?.lease_token), true);
    } finally {
      await first.close();
      await second.close();
    }

    const reopened = new PostgresRunnerQueue(dsn);
    try {
      const stored = await reopened.snapshot();
      assert.equal(stored.find((job) => job.id === id)?.status, 'done');
    } finally {
      await reopened.close();
    }
  });

  it('deduplicates the same idempotency key across queue clients', async (t) => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      t.skip('AQA_TEST_POSTGRES_DSN is required for the live PostgreSQL contract');
      return;
    }
    const first = new PostgresRunnerQueue(dsn);
    const second = new PostgresRunnerQueue(dsn);
    const key = `queue-idempotency-${randomUUID()}`;
    try {
      const original = await first.enqueue({
        id: randomUUID(),
        payload: { project: 'demo', profile: 'smoke' },
        enqueued_at: new Date().toISOString(),
        idempotency_key: key,
        idempotency_fingerprint: 'same-request',
      });
      const retry = await second.enqueue({
        id: randomUUID(),
        payload: { project: 'demo', profile: 'smoke' },
        enqueued_at: new Date().toISOString(),
        idempotency_key: key,
        idempotency_fingerprint: 'same-request',
      });
      assert.equal(retry.id, original.id);
      await assert.rejects(
        () =>
          second.enqueue({
            id: randomUUID(),
            payload: { project: 'demo', profile: 'release-gate' },
            enqueued_at: new Date().toISOString(),
            idempotency_key: key,
            idempotency_fingerprint: 'different-request',
          }),
        IdempotencyConflictError,
      );
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('serializes scoped quota admission across concurrent PostgreSQL clients', async (t) => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      t.skip('AQA_TEST_POSTGRES_DSN is required for the live PostgreSQL contract');
      return;
    }
    const first = new PostgresRunnerQueue(dsn, { quota: { concurrent_runs_max: 1 } });
    const second = new PostgresRunnerQueue(dsn, { quota: { concurrent_runs_max: 1 } });
    const scope = `quota-org-${randomUUID()}`;
    const payload = { org: scope, project: 'quota-project', scenario_count: 1 };
    try {
      const results = await Promise.allSettled([
        first.enqueue({ id: randomUUID(), payload, enqueued_at: new Date().toISOString() }),
        second.enqueue({ id: randomUUID(), payload, enqueued_at: new Date().toISOString() }),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = results.find((result) => result.status === 'rejected');
      assert.ok(rejected && rejected.reason instanceof ResourceQuotaExceededError);
    } finally {
      await first.close();
      await second.close();
    }
  });
});
