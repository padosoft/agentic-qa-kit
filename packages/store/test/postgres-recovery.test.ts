import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type RecoveryQueryClient,
  assertPostgresRecoveryTarget,
  observePostgresRecovery,
} from '../dist/index.js';

function client(row: Record<string, unknown>): RecoveryQueryClient {
  return {
    async unsafe(query) {
      assert.match(query, /pg_is_in_recovery\(\)/);
      assert.match(query, /pg_last_wal_replay_lsn\(\)/);
      return [row] as never;
    },
  };
}

describe('Postgres recovery observation', () => {
  it('collects only provider recovery state and emits a stable redacted record', async () => {
    const observation = await observePostgresRecovery(
      client({
        in_recovery: true,
        transaction_read_only: 'on',
        replay_lsn: '0/16B3740',
        replay_timestamp: '2026-09-18T12:00:00.000Z',
        server_version: '16.4',
      }),
      () => new Date('2026-09-18T12:01:00.000Z'),
    );
    assert.deepEqual(observation, {
      schema_version: '1',
      observed_at: '2026-09-18T12:01:00.000Z',
      in_recovery: true,
      transaction_read_only: true,
      replay_lsn: '0/16B3740',
      replay_timestamp: '2026-09-18T12:00:00.000Z',
      server_version: '16.4',
    });
    assertPostgresRecoveryTarget(observation);
  });

  it('fails closed when the target is writable or not in recovery', async () => {
    const observation = await observePostgresRecovery(
      client({
        in_recovery: false,
        transaction_read_only: 'off',
        replay_lsn: null,
        replay_timestamp: null,
        server_version: '16.4',
      }),
    );
    assert.throws(() => assertPostgresRecoveryTarget(observation), /not in recovery mode/);
  });

  it('rejects malformed provider observations', async () => {
    await assert.rejects(
      observePostgresRecovery(
        client({
          in_recovery: true,
          transaction_read_only: 'on',
          replay_lsn: 'not-a-lsn',
          replay_timestamp: null,
          server_version: '16.4',
        }),
      ),
      /invalid replay LSN/,
    );
  });
});
