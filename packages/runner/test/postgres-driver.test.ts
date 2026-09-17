import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makePostgresSqlProbeRunner } from '../dist/postgres.js';

const dsn = process.env.AQA_TEST_POSTGRES_DSN;

describe('Postgres SQL probe driver', () => {
  it('executes a read-only query through the real PostgreSQL adapter when configured', async () => {
    if (!dsn) {
      console.warn('SKIP postgres driver contract: AQA_TEST_POSTGRES_DSN is not configured');
      return;
    }
    const runner = makePostgresSqlProbeRunner({
      connectionString: dsn,
      statementTimeoutMs: 5_000,
      maxRows: 2,
    });
    try {
      const result = await runner({
        id: 'probe-postgres-version',
        kind: 'sql',
        with: { query: 'SELECT 1 AS ok' },
        timeout_ms: 5_000,
      });
      assert.deepEqual(result.body, [{ ok: 1 }]);
      assert.equal(result.error, undefined);
    } finally {
      await runner.close();
    }
  });
});
