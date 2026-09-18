import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPostgresRecoveryTarget, observePostgresRecoveryAtDsn } from '../dist/index.js';

const dsn = process.env.AQA_TEST_POSTGRES_RECOVERY_DSN?.trim();

test(
  'observes an operator-owned PostgreSQL recovery target in read-only mode',
  { skip: dsn ? false : 'AQA_TEST_POSTGRES_RECOVERY_DSN is not configured' },
  async () => {
    if (!dsn) return;
    const observation = assertPostgresRecoveryTarget(await observePostgresRecoveryAtDsn(dsn));
    assert.equal(observation.schema_version, '1');
    assert.equal(observation.in_recovery, true);
    assert.equal(observation.transaction_read_only, true);
    assert.match(observation.observed_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(observation.server_version, /^\d+(?:\.\d+)+/);

    const expectedMajor = process.env.AQA_TEST_POSTGRES_RECOVERY_EXPECTED_MAJOR?.trim();
    if (expectedMajor !== undefined) {
      assert.match(expectedMajor, /^\d+$/);
      assert.match(observation.server_version, new RegExp(`^${expectedMajor}\\.`));
    }

    const expectedLsn = process.env.AQA_TEST_POSTGRES_RECOVERY_EXPECTED_LSN?.trim();
    if (expectedLsn !== undefined) assert.equal(observation.replay_lsn, expectedLsn);
  },
);
