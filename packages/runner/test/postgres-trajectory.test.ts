import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { PostgresAgentTrajectoryStore } from '../dist/trajectory.js';

const dsn = process.env.AQA_TEST_POSTGRES_DSN;

describe('Postgres agent trajectory store', () => {
  it('shares immutable trajectory evidence across store instances when configured', async () => {
    if (!dsn) {
      console.warn('SKIP: AQA_TEST_POSTGRES_DSN is required for the live PostgreSQL contract');
      return;
    }
    const runId = `trajectory-${randomUUID()}`;
    const snapshot = {
      schema_version: '1' as const,
      run_id: runId,
      scenario_id: 'scenario-live-postgres',
      agent_id: 'agent-live',
      model: { provider: 'fixture', model_id: 'trajectory-contract' },
      steps: [],
      totals: { input: 0, output: 0 },
    };
    const first = new PostgresAgentTrajectoryStore({ dsn });
    const second = new PostgresAgentTrajectoryStore({ dsn });
    try {
      const created = await first.save(snapshot);
      const retry = await second.save(snapshot);
      assert.equal(retry.digest, created.digest);
      assert.deepEqual(await second.load(runId, snapshot.scenario_id), snapshot);
      await assert.rejects(
        () =>
          second.save({
            ...snapshot,
            agent_id: 'different-agent',
          }),
        /immutable and already exists/,
      );
    } finally {
      await first.close();
      await second.close();
    }
  });
});
