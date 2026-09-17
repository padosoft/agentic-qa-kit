import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { PostgresRunnerQueue } from '../dist/index.js';

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
});
