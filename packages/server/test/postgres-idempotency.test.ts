import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { PostgresApiIdempotencyStore } from '../dist/index.js';

describe('PostgresApiIdempotencyStore', () => {
  it('coalesces concurrent replicas and fences a changed request', async () => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      console.warn('SKIP: AQA_TEST_POSTGRES_DSN is required for the live PostgreSQL contract');
      return;
    }
    const first = new PostgresApiIdempotencyStore(dsn, { wait_ms: 5_000 });
    const second = new PostgresApiIdempotencyStore(dsn, { wait_ms: 5_000 });
    const operation = {
      scope: `integration-${randomUUID()}:POST:/api/orgs`,
      key: 'same-key',
      fingerprint: 'same-request',
    };
    let calls = 0;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      const gate = new Promise<void>((done) => {
        release = done;
      });
      void first.execute(operation, async () => {
        calls += 1;
        resolve();
        await gate;
        return { status: 201, body: { id: 'org-1' } };
      });
    });
    try {
      await started;
      const retry = second.execute(operation, async () => {
        calls += 1;
        return { status: 201, body: { id: 'wrong' } };
      });
      release();
      assert.deepEqual(await retry, { status: 201, body: { id: 'org-1' } });
      assert.equal(calls, 1);
      assert.equal(
        (
          await second.execute({ ...operation, fingerprint: 'different-request' }, async () => ({
            status: 201,
            body: { id: 'wrong' },
          }))
        ).status,
        409,
      );
    } finally {
      await first.close();
      await second.close();
    }
  });
});
