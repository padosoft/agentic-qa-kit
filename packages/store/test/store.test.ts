import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryStore, PostgresStore } from '../dist/index.js';

const RUN = {
  schema_version: '1' as const,
  id: 'run-a',
  started_at: '2026-05-17T10:00:00Z',
  finished_at: '2026-05-17T10:05:00Z',
  state: 'succeeded' as const,
  project: 'demo',
  profile: 'smoke',
  execution_mode: 'orchestrator' as const,
  config_snapshot: {
    profile: 'smoke',
    execution_mode: 'orchestrator' as const,
    packs: [],
    config_hash: 'a'.repeat(64),
  },
  totals: {
    scenarios: 0,
    findings: 0,
    probes: 0,
    llm_tokens_in: 0,
    llm_tokens_out: 0,
    llm_cost_usd: 0,
  },
  artifact_dir: '.aqa/runs/run-a',
};

describe('MemoryStore', () => {
  it('round-trips a Run', async () => {
    const s = new MemoryStore();
    await s.saveRun(RUN);
    const r = await s.loadRun('run-a');
    assert.deepEqual(r, RUN);
  });

  it('lists runs newest-first and filters by project', async () => {
    const s = new MemoryStore();
    await s.saveRun(RUN);
    await s.saveRun({ ...RUN, id: 'run-b', project: 'other', started_at: '2026-05-17T11:00:00Z' });
    const all = await s.listRuns();
    assert.equal(all[0]?.id, 'run-b');
    const demo = await s.listRuns({ project: 'demo' });
    assert.equal(demo.length, 1);
  });

  it('filters findings by run_id + severity', async () => {
    const s = new MemoryStore();
    const f = {
      schema_version: '1' as const,
      id: 'AQA-2026-0001',
      run_id: 'run-a',
      scenario_id: 's',
      risk_id: 'r',
      title: 't',
      summary: 'long enough summary',
      severity: 'high' as const,
      status: 'draft' as const,
      execution_mode: 'orchestrator' as const,
      discovered_at: '2026-05-17T10:00:00Z',
      confidence: 0.5,
      confidence_components: {},
      reproducibility: {},
      verification_floor: 'scenario_level' as const,
      evidence: [],
      tags: [],
    };
    await s.appendFinding(f);
    assert.equal((await s.listFindings({ run_id: 'run-a' })).length, 1);
    assert.equal((await s.listFindings({ severity: 'critical' })).length, 0);
  });

  it('close() clears state', async () => {
    const s = new MemoryStore();
    await s.saveRun(RUN);
    await s.close();
    assert.equal((await s.listRuns()).length, 0);
  });
});

describe('PostgresStore (v0.3 scaffold)', () => {
  it('refuses empty DSN at construction', () => {
    assert.throws(() => new PostgresStore(''), /DSN is empty/);
  });
  it('every method throws "not implemented" with a clear message', async () => {
    const s = new PostgresStore('postgres://localhost/aqa');
    await assert.rejects(() => s.saveRun(RUN), /not implemented/);
    await assert.rejects(() => s.loadRun('x'), /not implemented/);
    // Profile CRUD (v1.7 slice 4c) — keep this list in sync with the
    // Store interface so the scaffold contract stays accurate as new
    // methods are added.
    await assert.rejects(() => s.listProfiles(), /not implemented/);
    await assert.rejects(() => s.loadProfile('p'), /not implemented/);
    await assert.rejects(
      () =>
        s.saveProfile({
          schema_version: '1',
          name: 'p',
          execution_mode: 'orchestrator',
          llm_usage: [],
          llm_budget_usd: null,
          packs: [],
          tags: [],
          parallelism: 1,
          require_deterministic_replay: false,
        }),
      /not implemented/,
    );
    await assert.rejects(
      () =>
        s.createProfile({
          schema_version: '1',
          name: 'p',
          execution_mode: 'orchestrator',
          llm_usage: [],
          llm_budget_usd: null,
          packs: [],
          tags: [],
          parallelism: 1,
          require_deterministic_replay: false,
        }),
      /not implemented/,
    );
    await assert.rejects(() => s.deleteProfile('p'), /not implemented/);
    // Scenario CRUD (v1.7 slice 4c.6) — assert the whole scenario
    // surface so the scaffold contract stays accurate as the
    // interface evolves.
    await assert.rejects(() => s.listScenarios(), /not implemented/);
    await assert.rejects(() => s.loadScenario('s'), /not implemented/);
    await assert.rejects(
      () =>
        s.saveScenario({
          schema_version: '1',
          id: 's',
          title: 'A scaffold-test scenario',
          risk_refs: ['risk-x'],
          invariant_refs: [],
          preconditions: [],
          steps: [
            { id: 'probe-1', kind: 'http', with: {}, timeout_ms: 30_000 },
          ],
          oracles: [
            { id: 'oracle-1', kind: 'http_status', with: {}, weight: 1 },
          ],
          cleanup: [],
          tags: [],
        }),
      /not implemented/,
    );
    await assert.rejects(() => s.deleteScenario('s'), /not implemented/);
  });
});
