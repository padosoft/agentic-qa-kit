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

const FINDING = {
  schema_version: '1' as const,
  id: 'AQA-2026-9001',
  run_id: 'run-a',
  scenario_id: 'checkout',
  risk_id: 'payment',
  title: 'Payment error',
  summary: 'A payment error can be reproduced during checkout.',
  severity: 'high' as const,
  status: 'draft' as const,
  execution_mode: 'orchestrator' as const,
  discovered_at: '2026-05-17T10:00:00Z',
  confidence: 0.8,
  confidence_components: {},
  reproducibility: {},
  verification_floor: 'scenario_level' as const,
  evidence: [],
  tags: [],
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

  it('atomically changes finding status and appends its audit event', async () => {
    const s = new MemoryStore();
    await s.appendFinding(FINDING);
    const result = await s.transitionFindingStatus(
      FINDING.id,
      'rejected',
      'qa-user',
      'not reproducible after verification',
    );
    assert.equal(result?.finding.status, 'rejected');
    assert.equal(result?.event.payload.action, 'finding_status_changed');
    assert.equal((await s.listEvents(FINDING.run_id)).length, 1);
    assert.equal((await s.loadFinding(FINDING.id))?.status, 'rejected');
  });

  it('keeps newly written configuration resources isolated by tenant scope', async () => {
    const s = new MemoryStore();
    const profile = {
      schema_version: '1' as const,
      name: 'shared-profile',
      execution_mode: 'orchestrator' as const,
      llm_usage: [],
      llm_budget_usd: null,
      parallelism: 1,
      require_deterministic_replay: false,
      packs: [],
      tags: [],
    };
    const alpha = { org: 'acme', project: 'alpha' };
    const beta = { org: 'acme', project: 'beta' };
    await s.saveProfile(profile, alpha);
    await s.saveProfile({ ...profile, tags: ['beta'] }, beta);
    assert.deepEqual((await s.loadProfile(profile.name, alpha))?.tags, []);
    assert.deepEqual((await s.loadProfile(profile.name, beta))?.tags, ['beta']);
    assert.equal((await s.listProfiles(alpha)).length, 1);
    assert.equal((await s.listProfiles(beta)).length, 1);
  });

  it('never falls back from a tenant-scoped read to a legacy global record', async () => {
    const s = new MemoryStore();
    const profile = {
      schema_version: '1' as const,
      name: 'legacy-profile',
      execution_mode: 'orchestrator' as const,
      llm_usage: [],
      llm_budget_usd: null,
      parallelism: 1,
      require_deterministic_replay: false,
      packs: [],
      tags: ['global'],
    };
    await s.saveProfile(profile);
    assert.deepEqual(await s.loadProfile(profile.name), profile);
    assert.equal(await s.loadProfile(profile.name, { org: 'acme', project: 'alpha' }), null);
    assert.deepEqual(await s.listProfiles({ org: 'acme', project: 'alpha' }), []);
  });

  it('migrates legacy configuration only into an explicit namespace and never overwrites it', async () => {
    const store = new MemoryStore();
    const profile = {
      schema_version: '1' as const,
      name: 'legacy-profile',
      execution_mode: 'orchestrator' as const,
      llm_usage: [],
      llm_budget_usd: null,
      parallelism: 1,
      require_deterministic_replay: false,
      packs: [],
      tags: [],
    };
    await store.saveProfile(profile);
    const first = await store.migrateLegacyConfiguration({ org: 'acme', project: 'shop' });
    assert.deepEqual(first, { migrated: 1, skipped: 0, conflicts: [] });
    assert.equal(await store.loadProfile(profile.name), null);
    assert.deepEqual(
      await store.loadProfile(profile.name, { org: 'acme', project: 'shop' }),
      profile,
    );

    await store.saveProfile(profile);
    const conflict = await store.migrateLegacyConfiguration({ org: 'acme', project: 'shop' });
    assert.equal(conflict.migrated, 0);
    assert.deepEqual(conflict.conflicts, [`profile:${profile.name}`]);
    assert.deepEqual(await store.loadProfile(profile.name), profile);
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
      await reopened.saveRun({
        ...RUN,
        id: 'cost-run',
        totals: {
          ...RUN.totals,
          llm_tokens_in: 11,
          llm_tokens_out: 7,
          llm_cost_usd: 1.25,
        },
      });
      const costs = await reopened.costSummary({
        org: 'demo-org',
        project: RUN.project,
        from: '2026-05-17T00:00:00Z',
        to: '2026-05-17T23:59:59Z',
      });
      assert.equal(costs.total_usd, 1.25);
      assert.deepEqual(costs.by_profile, [
        {
          profile: RUN.profile,
          llm_tokens_in: 11,
          llm_tokens_out: 7,
          llm_cost_usd: 1.25,
          runs: 2,
        },
      ]);

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
      await reopened.saveProfile(profile, { org: 'ci-org', project: 'alpha' });
      await reopened.saveProfile(
        { ...profile, tags: ['beta'] },
        { org: 'ci-org', project: 'beta' },
      );
      assert.deepEqual(
        (await reopened.listProfiles({ org: 'ci-org', project: 'beta' })).find(
          (item) => item.name === profile.name,
        )?.tags,
        ['beta'],
      );

      const user = {
        id: 'ci-user',
        email: 'ci-user@example.com',
        display_name: 'CI User',
        roles: ['admin'] as const,
        status: 'active' as const,
        last_active_at: '2026-05-17T10:00:00Z',
      };
      await reopened.upsertUser(user);
      assert.deepEqual(await reopened.listUsers(), [user]);

      await reopened.appendFinding(FINDING);
      const beforeTransitionHashes = new Set(
        (await reopened.listEvents(FINDING.run_id)).map((event) => event.hash),
      );
      const transitions = await Promise.all([
        reopened.transitionFindingStatus(FINDING.id, 'rejected', 'ci-a', 'first decision'),
        reopened.transitionFindingStatus(FINDING.id, 'fixed', 'ci-b', 'second decision'),
      ]);
      assert.equal(transitions.filter(Boolean).length, 2);
      const auditEvents = (await reopened.listEvents(FINDING.run_id)).filter(
        (event) =>
          event.payload.action === 'finding_status_changed' &&
          !beforeTransitionHashes.has(event.hash),
      );
      assert.equal(auditEvents.length, 2);
      assert.equal(new Set(auditEvents.map((event) => event.seq)).size, 2);
      assert.equal(new Set(auditEvents.map((event) => event.hash)).size, 2);
    } finally {
      await reopened.close();
    }
  });
});
