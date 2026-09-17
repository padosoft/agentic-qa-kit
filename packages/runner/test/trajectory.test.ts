import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { EventChainWriter } from '../dist/events.js';
import {
  AgentTrajectoryRecorder,
  AgentTrajectoryStore,
  PostgresAgentTrajectoryStore,
  verifyAgentTrajectory,
} from '../dist/trajectory.js';

function recorder(options: Partial<ConstructorParameters<typeof AgentTrajectoryRecorder>[0]> = {}) {
  return new AgentTrajectoryRecorder({
    events: new EventChainWriter('/tmp/_ignore', { persist: false }),
    run_id: 'run-trajectory',
    scenario_id: 'scenario-agent',
    model: { provider: 'fixture', model_id: 'agent-v1', model_version_hash: 'hash-v1' },
    max_steps: 3,
    ...options,
  });
}

describe('AgentTrajectoryRecorder', () => {
  it('pins model identity and records opaque, ordered steps', () => {
    const events = new EventChainWriter('/tmp/_ignore', { persist: false });
    const r = recorder({ events, agent_id: 'qa-agent' });
    const llm = r.recordLlmCall({
      operation: 'plan',
      input: { prompt: 'customer secret' },
      output: { tool: 'read_cart' },
      usage: { input: 10, output: 4 },
    });
    const tool = r.recordToolCall({
      operation: 'read_cart',
      input: { token: 'secret-value' },
      output: { total_minor: 1250 },
      usage: { input: 0, output: 0 },
    });
    assert.equal(llm.seq, 0);
    assert.equal(tool.seq, 1);
    const snapshot = r.snapshot();
    assert.deepEqual(snapshot.totals, { input: 10, output: 4 });
    assert.equal(snapshot.agent_id, 'qa-agent');
    assert.equal(JSON.stringify(snapshot).includes('secret-value'), false);
    assert.equal(events.snapshot()[1]?.actor.model, 'fixture/agent-v1');
    assert.equal(events.snapshot()[0]?.kind, 'llm_call');
    assert.deepEqual(verifyAgentTrajectory(snapshot, events.snapshot()), { ok: true });
    const tampered = { ...snapshot, steps: [{ ...snapshot.steps[0], operation: 'unsafe' }] };
    assert.equal(verifyAgentTrajectory(tampered, events.snapshot()).ok, false);
  });

  it('fails closed on step and token budgets', () => {
    const r = recorder({ max_steps: 1, max_tokens: 3 });
    r.recordLlmCall({ operation: 'plan', input: {}, usage: { input: 2, output: 1 } });
    assert.throws(() => r.recordToolCall({ operation: 'read_cart', input: {} }), /step budget/);
    const tokenLimited = recorder({ max_tokens: 2 });
    assert.throws(
      () =>
        tokenLimited.recordLlmCall({
          operation: 'plan',
          input: {},
          usage: { input: 2, output: 1 },
        }),
      /token budget/,
    );
  });

  it('rejects invalid recorder configuration and usage', () => {
    assert.throws(() => recorder({ max_steps: 0 }), /max_steps/);
    assert.throws(
      () => recorder({ model: { provider: '', model_id: 'agent-v1' } }),
      /provider and model_id/,
    );
    assert.throws(
      () =>
        recorder().recordLlmCall({ operation: 'plan', input: {}, usage: { input: -1, output: 0 } }),
      /token usage/,
    );
  });

  it('rejects broken sequence and reconciled totals', () => {
    const snapshot = recorder().snapshot();
    assert.equal(verifyAgentTrajectory(snapshot).ok, true);
    assert.equal(verifyAgentTrajectory({ ...snapshot, totals: { input: 1, output: 0 } }).ok, false);
    assert.equal(
      verifyAgentTrajectory({
        ...snapshot,
        steps: [
          {
            seq: 1,
            kind: 'tool_call',
            operation: 'read_cart',
            status: 'completed',
            input_sha256: '0'.repeat(64),
          },
        ],
        totals: { input: 0, output: 0 },
      }).ok,
      false,
    );
  });

  it('persists immutable artifacts and verifies their envelope on read', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-trajectory-'));
    try {
      const snapshot = recorder().snapshot();
      const store = new AgentTrajectoryStore({ root });
      const artifact = store.save(snapshot);
      assert.equal(store.load(snapshot.run_id, snapshot.scenario_id).run_id, snapshot.run_id);
      assert.equal(store.save(snapshot).digest, artifact.digest);
      const envelope = JSON.parse(readFileSync(artifact.path, 'utf8')) as Record<string, unknown>;
      envelope.snapshot_sha256 = '0'.repeat(64);
      writeFileSync(artifact.path, JSON.stringify(envelope));
      assert.throws(() => store.load(snapshot.run_id, snapshot.scenario_id), /integrity/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects unsafe path identities and oversized artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-trajectory-'));
    try {
      assert.throws(
        () => new AgentTrajectoryStore({ root, max_bytes: 10 }).save(recorder().snapshot()),
        /byte budget/,
      );
      const unsafe = recorder({ run_id: '../escape' }).snapshot();
      assert.throws(() => new AgentTrajectoryStore({ root }).save(unsafe), /path segment/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists immutable trajectory identities through the PostgreSQL contract', async () => {
    const rows = new Map<string, { snapshot_sha256: string; envelope: unknown }>();
    const client = {
      async unsafe(query: string, parameters: unknown[] = []) {
        if (query.startsWith('CREATE TABLE')) return [];
        const run = String(parameters[0]);
        const scenario = String(parameters[1]);
        const key = `${run}/${scenario}`;
        if (query.startsWith('INSERT')) {
          if (rows.has(key)) return [];
          rows.set(key, {
            snapshot_sha256: String(parameters[2]),
            envelope: JSON.parse(String(parameters[3])),
          });
          return [{ snapshot_sha256: String(parameters[2]) }];
        }
        const row = rows.get(key);
        return row ? [{ run_id: run, scenario_id: scenario, ...row }] : [];
      },
    };
    const store = new PostgresAgentTrajectoryStore({ client });
    const snapshot = recorder().snapshot();
    const first = await store.save(snapshot);
    const retry = await store.save(snapshot);
    assert.equal(retry.digest, first.digest);
    await assert.rejects(
      () => store.save({ ...snapshot, agent_id: 'different-agent' }),
      /immutable and already exists/,
    );
    assert.deepEqual(await store.load(snapshot.run_id, snapshot.scenario_id), snapshot);
    const stored = rows.get(`${snapshot.run_id}/${snapshot.scenario_id}`);
    assert.ok(stored);
    stored.envelope = { ...(stored.envelope as object), snapshot_sha256: '0'.repeat(64) };
    await assert.rejects(
      () => store.load(snapshot.run_id, snapshot.scenario_id),
      /integrity|database digest/,
    );
  });

  it('requires a DSN or injected client and rejects unsafe database identities', async () => {
    assert.throws(() => new PostgresAgentTrajectoryStore({}), /PostgreSQL DSN is required/);
    const client = { unsafe: async () => [] };
    const store = new PostgresAgentTrajectoryStore({ client });
    await assert.rejects(() => store.load('../escape', 'scenario-agent'), /path segment/);
  });
});
