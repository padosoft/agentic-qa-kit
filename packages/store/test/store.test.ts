import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  createMethodologyArtifactEnvelope,
  createMethodologyArtifactLifecycle,
  createMethodologyProposal,
  methodologyArtifactSha256,
} from '@aqa/methodology';
import { MemoryStore, PostgresStore } from '../dist/index.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}

function hashEvent(event: Record<string, unknown>, prevHash = '0'.repeat(64)): string {
  const { prev_hash: _prevHash, hash: _hash, ...rest } = event;
  return createHash('sha256').update(prevHash).update(canonical(rest)).digest('hex');
}

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
  failure_fingerprint: 'a'.repeat(64),
  reproducibility: {},
  verification_floor: 'scenario_level' as const,
  evidence: [],
  tags: [],
};

const METHODOLOGY_ARTIFACT = createMethodologyArtifactEnvelope({
  artifact_kind: 'attack_tree',
  artifact_id: 'checkout-tree',
  revision: 1,
  created_at: '2026-09-19T14:00:00.000Z',
  payload: {
    id: 'attack-checkout',
    kind: 'node',
    operator: 'any',
    children: [{ id: 'checkout-payment', kind: 'leaf', statement: 'Payment is captured twice' }],
  },
});

describe('MemoryStore', () => {
  it('identifies its process-local durability boundary', () => {
    assert.equal(new MemoryStore().isDurable?.(), false);
  });
  it('round-trips a Run', async () => {
    const s = new MemoryStore();
    await s.saveRun(RUN);
    const r = await s.loadRun('run-a');
    assert.deepEqual(r, RUN);
  });

  it('fails closed for scoped audit reads without authoritative tenant metadata', async () => {
    const s = new MemoryStore();
    await s.saveRun({ ...RUN, id: 'run-tenant-a', org: 'org-a', project: 'shop' });
    const event = {
      schema_version: '1' as const,
      seq: 0,
      prev_hash: null,
      hash: '',
      ts: '2026-05-17T10:00:00Z',
      run_id: 'run-tenant-a',
      kind: 'info' as const,
      actor: { type: 'system' as const, id: 'tenant-test' },
      payload: { message: 'tenant event' },
    };
    event.hash = hashEvent(event);
    await s.appendEvent(event);
    assert.equal((await s.listAuditEvents({ org: 'org-a', project: 'shop' })).length, 1);
    assert.equal((await s.listAuditEvents({ org: 'org-b', project: 'shop' })).length, 0);
    const preRunEvent = { ...event, run_id: 'run-late', seq: 1, hash: '' };
    preRunEvent.hash = hashEvent(preRunEvent);
    await s.appendEvent(preRunEvent);
    await s.saveRun({ ...RUN, id: 'run-late', org: 'org-a', project: 'shop' });
    assert.equal((await s.listAuditEvents({ org: 'org-a', project: 'shop' })).length, 1);
    const explicitlyScopedEvent = {
      ...event,
      hash: '',
      run_id: 'run-without-provenance',
      seq: 2,
    };
    explicitlyScopedEvent.hash = hashEvent(explicitlyScopedEvent);
    await s.appendEvent(explicitlyScopedEvent, { org: 'org-a', project: 'shop' });
    assert.equal((await s.listAuditEvents({ org: 'org-a', project: 'shop' })).length, 2);
    const legacy = {
      ...event,
      hash: hashEvent({ ...event, hash: '' }, event.hash),
      run_id: 'run-a',
    };
    await s.appendEvent(legacy);
    assert.equal((await s.listAuditEvents({ org: 'org-a', project: 'shop' })).length, 2);
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

  it('routes the legacy status update API through the audited transition', async () => {
    const s = new MemoryStore();
    await s.appendFinding(FINDING);

    const updated = await s.updateFindingStatus(
      FINDING.id,
      'rejected',
      'qa-user',
      'not reproducible after verification',
    );

    assert.equal(updated?.status, 'rejected');
    const events = await s.listEvents(FINDING.run_id);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.payload.action, 'finding_status_changed');
    assert.equal(events[0]?.payload.reason, 'not reproducible after verification');
  });

  it('records deterministic fix evidence and reopens a fixed finding on regression', async () => {
    const s = new MemoryStore();
    await s.appendFinding(FINDING);
    const verification = {
      schema_version: '1' as const,
      verification_id: 'verification-2026-0001',
      observed_at: '2026-05-17T10:10:00Z',
      outcome: 'fixed' as const,
      attempts: 2,
      successes: 2,
      deterministic: true,
      evidence_path: '.aqa/runs/run-a/verification-1.json',
      actor: 'ci',
    };
    const fixed = await s.recordFindingVerification(FINDING.id, verification, 'ci');
    assert.equal(fixed?.finding.status, 'fixed');
    assert.equal(fixed?.event.kind, 'finding_verification_recorded');
    assert.equal(fixed?.finding.last_verification?.outcome, 'fixed');

    const regression = await s.recordFindingVerification(
      FINDING.id,
      {
        ...verification,
        verification_id: 'verification-2026-0002',
        observed_at: '2026-05-24T10:10:00Z',
        outcome: 'reproduced',
        fingerprint: 'a'.repeat(64),
        expected_fingerprint: 'a'.repeat(64),
      },
      'ci',
    );
    assert.equal(regression?.finding.status, 'regressed');
    assert.equal((await s.listEvents(FINDING.run_id)).length, 2);
  });

  it('rejects a no-op status transition without mutating or auditing', async () => {
    const s = new MemoryStore();
    await s.appendFinding(FINDING);
    await assert.rejects(
      s.transitionFindingStatus(FINDING.id, 'draft', 'qa-user', 'duplicate review'),
      /already draft/,
    );
    assert.equal((await s.loadFinding(FINDING.id))?.status, 'draft');
    assert.equal((await s.listEvents(FINDING.run_id)).length, 0);
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

  it('isolates directory users by organization and project scope', async () => {
    const s = new MemoryStore();
    const user = {
      id: 'same-id',
      email: 'same@example.com',
      display_name: 'Same User',
      roles: ['viewer'] as const,
      status: 'active' as const,
    };
    await s.upsertUser(user, { org: 'org-a', project: 'shop' });
    await s.upsertUser({ ...user, display_name: 'Other User' }, { org: 'org-b', project: 'shop' });
    assert.equal(
      (await s.listUsers({ org: 'org-a', project: 'shop' }))[0]?.display_name,
      'Same User',
    );
    assert.equal(
      (await s.listUsers({ org: 'org-b', project: 'shop' }))[0]?.display_name,
      'Other User',
    );
    assert.equal((await s.listUsers({ org: 'org-a', project: 'other' })).length, 0);
  });

  it('persists immutable methodology revisions by tenant scope', async () => {
    const s = new MemoryStore();
    await s.saveMethodologyArtifact(METHODOLOGY_ARTIFACT, { org: 'org-a', project: 'shop' });
    await s.saveMethodologyArtifact(
      { ...METHODOLOGY_ARTIFACT, revision: 2 },
      {
        org: 'org-a',
        project: 'shop',
      },
    );
    await s.saveMethodologyArtifact(METHODOLOGY_ARTIFACT, { org: 'org-b', project: 'shop' });
    assert.equal((await s.listMethodologyArtifacts({ org: 'org-a', project: 'shop' })).length, 2);
    assert.equal((await s.listMethodologyArtifacts({ project: 'shop' })).length, 3);
    const loaded = await s.loadMethodologyArtifact('checkout-tree', 1, {
      org: 'org-a',
      project: 'shop',
    });
    assert.ok(loaded);
    (loaded.payload as Record<string, unknown>).id = 'caller-mutated';
    assert.equal(
      (
        (await s.loadMethodologyArtifact('checkout-tree', 1, { org: 'org-a', project: 'shop' }))
          ?.payload as Record<string, unknown>
      ).id,
      'attack-checkout',
    );
    const listed = await s.listMethodologyArtifacts({ org: 'org-a', project: 'shop' });
    assert.ok(listed[0]);
    (listed[0].payload as Record<string, unknown>).id = 'list-mutated';
    assert.equal(
      (
        (await s.loadMethodologyArtifact('checkout-tree', 2, { org: 'org-a', project: 'shop' }))
          ?.payload as Record<string, unknown>
      ).id,
      'attack-checkout',
    );
    assert.equal(
      await s.loadMethodologyArtifact('checkout-tree', 1, { org: 'org-c', project: 'shop' }),
      null,
    );
    const conflictingPayload = {
      ...(METHODOLOGY_ARTIFACT.payload as Record<string, unknown>),
      id: 'attack-conflict',
    };
    await assert.rejects(
      () =>
        s.saveMethodologyArtifact(
          {
            ...METHODOLOGY_ARTIFACT,
            payload: conflictingPayload,
            artifact_sha256: methodologyArtifactSha256(conflictingPayload),
          },
          { org: 'org-a', project: 'shop' },
        ),
      /revision conflict/,
    );
  });

  it('enforces methodology archive, legal hold and expiry lifecycle by tenant scope', async () => {
    const s = new MemoryStore();
    const scope = { org: 'org-a', project: 'shop' };
    await s.saveMethodologyArtifact(METHODOLOGY_ARTIFACT, scope);
    const lifecycle = createMethodologyArtifactLifecycle({
      artifact_kind: METHODOLOGY_ARTIFACT.artifact_kind,
      artifact_id: METHODOLOGY_ARTIFACT.artifact_id,
      revision: METHODOLOGY_ARTIFACT.revision,
      now: '2026-09-19T10:00:00.000Z',
      updated_by: 'reviewer-1',
      retention_days: 30,
      archive_after_days: 7,
    });
    await s.saveMethodologyArtifactLifecycle(lifecycle, scope);
    const pendingProposal = createMethodologyProposal({
      proposal_id: 'proposal-retention-pending-memory',
      artifact_kind: METHODOLOGY_ARTIFACT.artifact_kind,
      artifact_id: METHODOLOGY_ARTIFACT.artifact_id,
      artifact: METHODOLOGY_ARTIFACT.payload,
      revision: METHODOLOGY_ARTIFACT.revision,
      proposed_by: 'agent-retention',
      proposed_at: '2026-09-19T10:01:00.000Z',
      source: 'agent',
    });
    await s.saveMethodologyProposal(pendingProposal, scope, METHODOLOGY_ARTIFACT);
    const held = await s.setMethodologyArtifactLegalHold(
      'checkout-tree',
      1,
      {
        now: '2026-09-20T10:00:00.000Z',
        updated_by: 'legal-1',
        enabled: true,
        reason: 'Legal hold',
      },
      scope,
    );
    assert.equal(held?.legal_hold, true);
    assert.equal(await s.purgeExpiredMethodologyArtifacts('2026-10-20T10:00:00.000Z', scope), 0);
    const released = await s.setMethodologyArtifactLegalHold(
      'checkout-tree',
      1,
      {
        now: '2026-10-21T10:00:00.000Z',
        updated_by: 'legal-1',
        enabled: false,
        reason: 'Hold released',
      },
      scope,
    );
    assert.equal(released?.legal_hold, false);
    const archived = await s.archiveMethodologyArtifact(
      'checkout-tree',
      1,
      {
        now: '2026-10-22T10:00:00.000Z',
        updated_by: 'reviewer-1',
        reason: 'Superseded',
      },
      scope,
    );
    assert.equal(archived?.state, 'archived');
    assert.equal(await s.purgeExpiredMethodologyArtifacts('2026-10-22T10:00:00.000Z', scope), 1);
    assert.equal(await s.loadMethodologyArtifact('checkout-tree', 1, scope), null);
    assert.equal(await s.loadMethodologyArtifactLifecycle('checkout-tree', 1, scope), null);
    assert.equal(
      (await s.loadMethodologyProposal(pendingProposal.proposal_id, scope))?.artifact,
      undefined,
    );
    assert.equal((await s.listMethodologyProposals({ ...scope, status: 'pending' })).length, 0);
    await assert.rejects(
      () =>
        s.approveMethodologyProposal(
          pendingProposal.proposal_id,
          {
            schema_version: '1',
            approval_id: 'approval-retention-pending-memory',
            proposal_id: pendingProposal.proposal_id,
            artifact_sha256: pendingProposal.artifact_sha256,
            revision: pendingProposal.revision,
            approved_by: 'reviewer-retention',
            approved_at: '2026-10-22T10:01:00.000Z',
          },
          scope,
        ),
      /purged or changed/,
    );
  });

  it('persists methodology proposals and approves them exactly once by tenant scope', async () => {
    const s = new MemoryStore();
    const proposal = createMethodologyProposal({
      proposal_id: 'proposal-memory',
      artifact_kind: METHODOLOGY_ARTIFACT.artifact_kind,
      artifact_id: METHODOLOGY_ARTIFACT.artifact_id,
      artifact: METHODOLOGY_ARTIFACT.payload,
      revision: METHODOLOGY_ARTIFACT.revision,
      proposed_by: 'agent-1',
      proposed_at: '2026-09-18T10:01:00.000Z',
      source: 'agent',
    });
    const scope = { org: 'org-a', project: 'shop' };
    await s.saveMethodologyProposal(proposal, scope, METHODOLOGY_ARTIFACT);
    await s.saveMethodologyProposal(proposal, scope, METHODOLOGY_ARTIFACT);
    assert.equal((await s.listMethodologyProposals({ ...scope, status: 'pending' })).length, 1);
    assert.deepEqual(
      (await s.loadMethodologyProposal(proposal.proposal_id, scope))?.artifact,
      METHODOLOGY_ARTIFACT,
    );
    assert.equal((await s.listMethodologyProposals({ org: 'other', project: 'shop' })).length, 0);
    await assert.rejects(
      () => s.saveMethodologyProposal({ ...proposal, proposed_by: 'forged' }, scope),
      /proposal conflict/,
    );
    const approval = {
      schema_version: '1' as const,
      approval_id: 'approval-memory',
      proposal_id: proposal.proposal_id,
      artifact_sha256: proposal.artifact_sha256,
      revision: proposal.revision,
      approved_by: 'reviewer-1',
      approved_at: '2026-09-18T10:02:00.000Z',
    };
    const result = await s.approveMethodologyProposal(proposal.proposal_id, approval, scope);
    assert.equal(result?.proposal.status, 'approved');
    assert.deepEqual(
      (await s.loadMethodologyProposal(proposal.proposal_id, scope))?.approval,
      approval,
    );
    assert.deepEqual(
      (await s.loadMethodologyProposal(proposal.proposal_id, scope))?.artifact,
      METHODOLOGY_ARTIFACT,
    );
    await assert.rejects(
      () => s.approveMethodologyProposal(proposal.proposal_id, approval, scope),
      /not pending/,
    );
    const rejectedProposal = { ...proposal, proposal_id: 'proposal-reject-memory' };
    await s.saveMethodologyProposal(rejectedProposal, scope, METHODOLOGY_ARTIFACT);
    const rejection = {
      schema_version: '1' as const,
      rejection_id: 'rejection-memory',
      proposal_id: rejectedProposal.proposal_id,
      rejected_by: 'reviewer-1',
      rejected_at: '2026-09-18T10:03:00.000Z',
      reason: 'Missing payment callback invariant',
    };
    const rejected = await s.rejectMethodologyProposal(
      rejectedProposal.proposal_id,
      rejection,
      scope,
    );
    assert.equal(rejected?.proposal.status, 'rejected');
    assert.deepEqual(
      (await s.loadMethodologyProposal(rejectedProposal.proposal_id, scope))?.rejection,
      rejection,
    );
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
    const postgresArtifact = { ...METHODOLOGY_ARTIFACT, artifact_id: 'checkout-durable' };
    const s = new PostgresStore(dsn);
    try {
      await s.saveRun(RUN);
      assert.deepEqual(await s.loadRun(RUN.id), RUN);
      const firstAuditEvent = {
        schema_version: '1',
        seq: 0,
        prev_hash: null,
        hash: '',
        ts: '2026-09-18T10:00:00Z',
        run_id: RUN.id,
        kind: 'oracle_evaluated',
        actor: { type: 'system', id: 'audit-contract' },
        payload: { oracle_id: 'contract', passed: true },
      };
      firstAuditEvent.hash = hashEvent(firstAuditEvent);
      await s.appendEvent(firstAuditEvent);
      const secondAuditEvent = {
        schema_version: '1',
        seq: 1,
        prev_hash: firstAuditEvent.hash,
        hash: '',
        ts: '2026-09-18T11:00:00Z',
        run_id: RUN.id,
        kind: 'info',
        actor: { type: 'system', id: 'audit-contract' },
        payload: { message: 'newer event' },
      };
      secondAuditEvent.hash = hashEvent(secondAuditEvent, firstAuditEvent.hash);
      await s.appendEvent(secondAuditEvent);
      const filteredAudit = await s.listAuditEvents({ kind: 'oracle_evaluated', limit: 1 });
      assert.equal(filteredAudit.length, 1);
      assert.equal(filteredAudit[0]?.kind, 'oracle_evaluated');
      const tenantRun = { ...RUN, id: 'run-a-tenant', org: 'org-a', project: 'shop' };
      await s.saveRun(tenantRun);
      const tenantEvent = {
        schema_version: '1' as const,
        seq: 2,
        prev_hash: secondAuditEvent.hash,
        hash: '',
        ts: '2026-09-18T12:00:00Z',
        run_id: tenantRun.id,
        kind: 'info' as const,
        actor: { type: 'system' as const, id: 'audit-tenant-contract' },
        payload: { message: 'tenant event' },
      };
      tenantEvent.hash = hashEvent(tenantEvent, secondAuditEvent.hash);
      await s.appendEvent(tenantEvent);
      assert.equal((await s.listAuditEvents({ org: 'org-a', project: 'shop' })).length, 1);
      assert.equal((await s.listAuditEvents({ org: 'org-b', project: 'shop' })).length, 0);
      const preRunTenantEvent = {
        ...tenantEvent,
        seq: 3,
        run_id: 'run-a-tenant-late',
        prev_hash: tenantEvent.hash,
        hash: '',
      };
      preRunTenantEvent.hash = hashEvent(preRunTenantEvent, tenantEvent.hash);
      await s.appendEvent(preRunTenantEvent);
      await s.saveRun({ ...tenantRun, id: preRunTenantEvent.run_id });
      assert.equal((await s.listAuditEvents({ org: 'org-a', project: 'shop' })).length, 1);
      const explicitlyScopedTenantEvent = {
        ...tenantEvent,
        seq: 4,
        run_id: 'run-a-tenant-explicit',
        prev_hash: preRunTenantEvent.hash,
        hash: '',
      };
      explicitlyScopedTenantEvent.hash = hashEvent(explicitlyScopedTenantEvent, preRunTenantEvent.hash);
      await s.appendEvent(explicitlyScopedTenantEvent, { org: 'org-a', project: 'shop' });
      assert.equal((await s.listAuditEvents({ org: 'org-a', project: 'shop' })).length, 2);
      assert.equal(
        (await s.listRuns({ project: RUN.project })).some((run) => run.id === RUN.id),
        true,
      );
      const specialScope = { org: 'org_a with space', project: 'shop_beta' };
      await s.saveMethodologyArtifact(postgresArtifact, specialScope);
      await s.saveMethodologyArtifact(postgresArtifact, specialScope);
      assert.equal((await s.listMethodologyArtifacts(specialScope)).length, 1);
      assert.equal(
        (await s.listMethodologyArtifacts({ org: 'org_b', project: 'shop_beta' })).length,
        0,
      );
      const retainedArtifact = { ...postgresArtifact, artifact_id: 'retention-contract' };
      const retainedLifecycle = createMethodologyArtifactLifecycle({
        artifact_kind: retainedArtifact.artifact_kind,
        artifact_id: retainedArtifact.artifact_id,
        revision: retainedArtifact.revision,
        now: '2026-09-19T14:00:00.000Z',
        updated_by: 'retention-test',
        retention_days: 1,
        archive_after_days: 1,
      });
      await s.saveMethodologyArtifactWithLifecycle(
        retainedArtifact,
        retainedLifecycle,
        specialScope,
      );
      await s.saveMethodologyArtifactWithLifecycle(
        retainedArtifact,
        retainedLifecycle,
        specialScope,
      );
      assert.deepEqual(
        await s.loadMethodologyArtifactLifecycle('retention-contract', 1, specialScope),
        retainedLifecycle,
      );
      const retentionProposal = createMethodologyProposal({
        proposal_id: 'proposal-retention-contract',
        artifact_kind: retainedArtifact.artifact_kind,
        artifact_id: retainedArtifact.artifact_id,
        artifact: retainedArtifact.payload,
        revision: retainedArtifact.revision,
        proposed_by: 'agent-retention',
        proposed_at: '2026-09-19T14:01:00.000Z',
        source: 'agent',
      });
      await s.saveMethodologyProposal(retentionProposal, specialScope, retainedArtifact);
      const pendingRetentionProposal = createMethodologyProposal({
        proposal_id: 'proposal-retention-pending-postgres',
        artifact_kind: retainedArtifact.artifact_kind,
        artifact_id: retainedArtifact.artifact_id,
        artifact: retainedArtifact.payload,
        revision: retainedArtifact.revision,
        proposed_by: 'agent-retention-pending',
        proposed_at: '2026-09-19T14:01:30.000Z',
        source: 'agent',
      });
      await s.saveMethodologyProposal(pendingRetentionProposal, specialScope, retainedArtifact);
      await s.approveMethodologyProposal(
        retentionProposal.proposal_id,
        {
          schema_version: '1',
          approval_id: 'approval-retention-contract',
          proposal_id: retentionProposal.proposal_id,
          artifact_sha256: retentionProposal.artifact_sha256,
          revision: 1,
          approved_by: 'reviewer-retention',
          approved_at: '2026-09-19T14:02:00.000Z',
        },
        specialScope,
      );
      assert.equal(
        await s.purgeExpiredMethodologyArtifacts('2026-09-21T14:00:00.000Z', specialScope),
        1,
      );
      assert.equal(await s.loadMethodologyArtifact('retention-contract', 1, specialScope), null);
      assert.equal(
        (await s.loadMethodologyProposal(retentionProposal.proposal_id, specialScope))?.artifact,
        undefined,
      );
      assert.equal(
        (await s.loadMethodologyProposal(pendingRetentionProposal.proposal_id, specialScope))
          ?.artifact,
        undefined,
      );
      assert.equal(
        (await s.listMethodologyProposals({ ...specialScope, status: 'pending' })).length,
        0,
      );
      await assert.rejects(
        () =>
          s.approveMethodologyProposal(
            pendingRetentionProposal.proposal_id,
            {
              schema_version: '1',
              approval_id: 'approval-retention-pending-postgres',
              proposal_id: pendingRetentionProposal.proposal_id,
              artifact_sha256: pendingRetentionProposal.artifact_sha256,
              revision: pendingRetentionProposal.revision,
              approved_by: 'reviewer-retention',
              approved_at: '2026-09-21T14:01:00.000Z',
            },
            specialScope,
          ),
        /purged or changed/,
      );
      const postgresProposal = createMethodologyProposal({
        proposal_id: 'proposal-postgres-durable',
        artifact_kind: postgresArtifact.artifact_kind,
        artifact_id: postgresArtifact.artifact_id,
        artifact: postgresArtifact.payload,
        revision: postgresArtifact.revision,
        proposed_by: 'agent-postgres',
        proposed_at: '2026-09-18T10:01:00.000Z',
        source: 'agent',
      });
      await s.saveMethodologyProposal(postgresProposal, specialScope, postgresArtifact);
      const postgresApproval = {
        schema_version: '1' as const,
        approval_id: 'approval-postgres-durable',
        proposal_id: postgresProposal.proposal_id,
        artifact_sha256: postgresProposal.artifact_sha256,
        revision: postgresProposal.revision,
        approved_by: 'reviewer-postgres',
        approved_at: '2026-09-18T10:02:00.000Z',
      };
      const concurrentApprovals = await Promise.allSettled([
        s.approveMethodologyProposal(postgresProposal.proposal_id, postgresApproval, specialScope),
        s.approveMethodologyProposal(
          postgresProposal.proposal_id,
          {
            ...postgresApproval,
            approval_id: `${postgresApproval.approval_id}-race`,
            approved_by: 'reviewer-postgres-race',
          },
          specialScope,
        ),
      ]);
      assert.equal(concurrentApprovals.filter((result) => result.status === 'fulfilled').length, 1);
      for (const result of concurrentApprovals) {
        if (result.status === 'rejected')
          assert.match(String(result.reason), /conflict|not pending/);
      }
      assert.equal(
        (await s.listMethodologyProposals({ ...specialScope, status: 'approved' })).length,
        1,
      );
      const postgresRejectedProposal = {
        ...postgresProposal,
        proposal_id: 'proposal-postgres-rejected',
      };
      await s.saveMethodologyProposal(postgresRejectedProposal, specialScope, postgresArtifact);
      const postgresRejection = {
        schema_version: '1' as const,
        rejection_id: 'rejection-postgres-durable',
        proposal_id: postgresRejectedProposal.proposal_id,
        rejected_by: 'reviewer-postgres-reject',
        rejected_at: '2026-09-18T10:03:00.000Z',
        reason: 'The checkout tree omits the payment callback invariant.',
      };
      const rejectedResult = await s.rejectMethodologyProposal(
        postgresRejectedProposal.proposal_id,
        postgresRejection,
        specialScope,
      );
      assert.equal(rejectedResult?.proposal.status, 'rejected');
      assert.deepEqual(rejectedResult?.rejection, postgresRejection);
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
      assert.deepEqual(
        await reopened.loadMethodologyArtifact('checkout-durable', 1, {
          org: 'org_a with space',
          project: 'shop_beta',
        }),
        { ...METHODOLOGY_ARTIFACT, artifact_id: 'checkout-durable' },
      );
      assert.equal(
        (
          await reopened.listMethodologyProposals({
            org: 'org_a with space',
            project: 'shop_beta',
            status: 'approved',
          })
        ).some((record) => record.proposal.artifact_id === 'checkout-durable'),
        true,
      );
      const reopenedRejected = await reopened.loadMethodologyProposal(
        'proposal-postgres-rejected',
        { org: 'org_a with space', project: 'shop_beta' },
      );
      assert.equal(reopenedRejected?.proposal.status, 'rejected');
      assert.deepEqual(reopenedRejected?.rejection, {
        schema_version: '1',
        rejection_id: 'rejection-postgres-durable',
        proposal_id: 'proposal-postgres-rejected',
        rejected_by: 'reviewer-postgres-reject',
        rejected_at: '2026-09-18T10:03:00.000Z',
        reason: 'The checkout tree omits the payment callback invariant.',
      });
      assert.deepEqual(reopenedRejected?.artifact, postgresArtifact);
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
      const legacyProfile = { ...profile, name: `legacy-${Date.now()}` };
      await reopened.saveProfile(legacyProfile);
      const migrated = await reopened.migrateLegacyConfiguration({
        org: 'ci-org',
        project: 'legacy-project',
      });
      assert.equal(migrated.conflicts.length, 0);
      assert.ok(migrated.migrated >= 1);
      assert.equal(await reopened.loadProfile(legacyProfile.name), null);
      assert.deepEqual(
        await reopened.loadProfile(legacyProfile.name, {
          org: 'ci-org',
          project: 'legacy-project',
        }),
        legacyProfile,
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
      // Concurrent decisions are serialized by the database advisory lock.
      // Depending on lock acquisition order, one decision may legitimately
      // become invalid after the other reaches a terminal state; that is a
      // conflict, not evidence that the store lost atomicity.
      const transitions = await Promise.allSettled([
        reopened.transitionFindingStatus(FINDING.id, 'rejected', 'ci-a', 'first decision'),
        reopened.transitionFindingStatus(FINDING.id, 'fixed', 'ci-b', 'second decision'),
      ]);
      const fulfilled = transitions.filter((result) => result.status === 'fulfilled');
      const rejected = transitions.filter((result) => result.status === 'rejected');
      assert.ok(fulfilled.length >= 1);
      for (const result of rejected) {
        assert.match(String(result.reason), /status transition .* is not allowed/);
      }
      const auditEvents = (await reopened.listEvents(FINDING.run_id)).filter(
        (event) =>
          event.payload.action === 'finding_status_changed' &&
          !beforeTransitionHashes.has(event.hash),
      );
      assert.equal(auditEvents.length, fulfilled.length);
      assert.equal(new Set(auditEvents.map((event) => event.seq)).size, fulfilled.length);
      assert.equal(new Set(auditEvents.map((event) => event.hash)).size, fulfilled.length);
    } finally {
      await reopened.close();
    }
  });
});
