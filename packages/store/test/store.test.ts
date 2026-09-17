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

  it('stores and loads SSO config snapshot', async () => {
    const s = new MemoryStore();
    const sampleConfig = {
      schema_version: '1' as const,
      provider: 'oidc',
      enabled: true,
      issuer_url: 'https://id.example.com/realms/main',
      client_id: 'aqa-admin',
      client_secret_set: true,
      allowed_email_domains: ['example.com'],
      claim_mappings: {
        'user.id': 'sub',
        'user.email': 'email',
        'user.role': 'groups[0]',
      },
    };
    s.__test_seedSsoConfig(sampleConfig);
    const loaded = await s.loadSsoConfig();
    assert.deepEqual(loaded, sampleConfig);
    await s.close();
    assert.equal(await s.loadSsoConfig(), null);
  });

  it('persists SSO config through saveSsoConfig()', async () => {
    const s = new MemoryStore();
    const sampleConfig = {
      schema_version: '1' as const,
      provider: 'oidc',
      enabled: false,
      issuer_url: 'https://id.example.com/realms/main',
      client_id: 'aqa-admin',
      client_secret_set: false,
      allowed_email_domains: ['example.com'],
      claim_mappings: {
        'user.id': 'sub',
        'user.email': 'email',
        'user.role': 'groups[0]',
      },
    };
    await s.saveSsoConfig(sampleConfig);
    assert.deepEqual(await s.loadSsoConfig(), sampleConfig);
  });
});

describe('PostgresStore', () => {
  it('refuses empty DSN at construction', () => {
    assert.throws(() => new PostgresStore(''), /DSN is empty/);
  });
  it('runs the durable contract when a PostgreSQL DSN is supplied', async () => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      assert.ok(true, 'integration contract requires AQA_TEST_POSTGRES_DSN');
      return;
    }
    const s = new PostgresStore(dsn);
    try {
      await s.saveRun(RUN);
      assert.deepEqual(await s.loadRun(RUN.id), RUN);
      assert.equal(
        (await s.listRuns({ project: RUN.project })).some((run) => run.id === RUN.id),
        true,
      );
    } finally {
      await s.close();
    }

    const reopened = new PostgresStore(dsn);
    try {
      assert.deepEqual(
        await reopened.loadRun(RUN.id),
        RUN,
        'a fresh store instance must read state written by the previous process',
      );

      const profile = {
        schema_version: '1' as const,
        name: 'ci-concurrency',
        execution_mode: 'orchestrator' as const,
        llm_usage: [],
        llm_budget_usd: null,
        parallelism: 1,
        require_deterministic_replay: false,
        packs: [],
        tags: [],
      };
      const creates = await Promise.all(
        Array.from({ length: 8 }, () => reopened.createProfile(profile)),
      );
      assert.equal(creates.filter((result) => result.created).length, 1);
      assert.deepEqual(await reopened.loadProfile(profile.name), profile);
    } finally {
      await reopened.close();
    }
  });
});
