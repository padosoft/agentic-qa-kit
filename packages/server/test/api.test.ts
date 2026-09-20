import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createMethodologyArtifactEnvelope, createMethodologyProposal } from '@aqa/methodology';
import { manifestDigest } from '@aqa/pack-scanner';
import { MemoryStore } from '@aqa/store';
import {
  MemoryApiIdempotencyStore,
  type QueueQuota,
  RunnerQueue,
  buildAsyncApiDocument,
  buildOpenApiDocument,
  makeApi,
} from '../dist/index.js';

const FAKE_USER = {
  id: '1',
  email: 'u@x.test',
  display_name: 'U',
  roles: ['admin' as const],
};

function ctx(
  opts: {
    projectRoot?: string;
    eventBus?: { publish: (event: unknown) => Promise<void> };
    quota?: QueueQuota;
    scimAuthorize?: (headers: Record<string, string>, org: string) => Promise<boolean>;
    packTrustedKeys?: Readonly<Record<string, string>>;
    packRequireSignature?: boolean;
    packSigstorePolicy?: { certificate_identity: string; certificate_oidc_issuer: string };
    verifyMethodologyProposal?: (
      proposal: unknown,
      artifact: unknown,
      scope: { org: string; project: string },
    ) => Promise<boolean>;
    budgetControl?: {
      halt: (key: string, reason: string) => Promise<void>;
      getHaltReason: (key: string) => Promise<string | null>;
    };
    runnerAuthorize?: (
      headers: Record<string, string>,
    ) => Promise<
      boolean | { runner_id: string; scopes: readonly { org: string; project?: string }[] }
    >;
  } = {},
) {
  return {
    store: new MemoryStore(),
    queue: new RunnerQueue({ quota: opts.quota }),
    authenticate: async () => FAKE_USER,
    ...(opts.eventBus ? { eventBus: opts.eventBus } : {}),
    ...(opts.scimAuthorize ? { scimAuthorize: opts.scimAuthorize } : {}),
    ...(opts.packTrustedKeys ? { packTrustedKeys: opts.packTrustedKeys } : {}),
    packRequireSignature: opts.packRequireSignature ?? false,
    ...(opts.packSigstorePolicy ? { packSigstorePolicy: opts.packSigstorePolicy } : {}),
    ...(opts.verifyMethodologyProposal
      ? { verifyMethodologyProposal: opts.verifyMethodologyProposal }
      : {}),
    ...(opts.budgetControl ? { budgetControl: opts.budgetControl } : {}),
    ...(opts.runnerAuthorize ? { runnerAuthorize: opts.runnerAuthorize } : {}),
    // The server is configured at boot with the on-disk project root
    // it manages. Endpoints that touch the filesystem (pack scaffold)
    // anchor to this path — they NEVER honor a client-supplied root,
    // since that would let an authenticated caller write anywhere the
    // server process can reach.
    projectRoot: opts.projectRoot,
  };
}

// Track every tmpdir created in this suite so a teardown hook can wipe
// them. Without this, every CI run leaks fully-scaffolded pack trees
// under the OS temp dir.
const TEMP_ROOTS: string[] = [];
function tmpProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aqa-server-pack-'));
  TEMP_ROOTS.push(root);
  return root;
}
after(() => {
  for (const root of TEMP_ROOTS) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort; never fail the suite over a tmpdir we can't remove
    }
  }
});

const TENANT_HEADERS = { 'x-aqa-org': 'padosoft', 'x-aqa-project': 'demo' };

const METHODOLOGY_TREE = {
  id: 'attack-checkout',
  kind: 'node' as const,
  operator: 'any' as const,
  children: [
    { id: 'checkout-payment', kind: 'leaf' as const, statement: 'Payment is captured twice' },
  ],
};

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, item]),
    );
  });
}

function eventHash(event: Record<string, unknown>, prevHash = '0'.repeat(64)): string {
  const { prev_hash: _prevHash, hash: _hash, ...rest } = event;
  return createHash('sha256').update(prevHash).update(canonical(rest)).digest('hex');
}

describe('makeApi', () => {
  it('publishes an OpenAPI operation for every concrete route with permission metadata', () => {
    const routes = makeApi();
    const document = buildOpenApiDocument(routes);
    const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
    assert.equal(document.openapi, '3.1.0');
    assert.equal(operations.length, routes.length);
    assert.ok(operations.every((operation) => typeof operation.operationId === 'string'));
    assert.ok(operations.some((operation) => operation['x-aqa-permission'] === 'runs:read'));
    assert.ok(document.paths['/api/runs/{id}']?.get);
  });

  it('publishes an AsyncAPI operation for every supported live event type', () => {
    const document = buildAsyncApiDocument();
    assert.equal(document.asyncapi, '3.0.0');
    assert.deepEqual(Object.keys(document.operations).sort(), [
      'receive_finding_status_changed',
      'receive_run_cancelled',
      'receive_run_requested',
    ]);
    assert.equal(document.components.schemas.BusEvent.type, 'object');
  });

  it('exposes the v1.4 route surface (>= 28 routes)', () => {
    const api = makeApi();
    assert.ok(api.length >= 28, `expected >= 28 routes, got ${api.length}`);
  });

  it('every route has a permission OR explicitly null (runner-only)', () => {
    for (const r of makeApi()) {
      const ok = r.requires === null || typeof r.requires === 'string';
      assert.ok(ok, `route ${r.method} ${r.path} has bad requires=${String(r.requires)}`);
    }
  });

  it('GET /api/runs requires tenant scope', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/runs');
    const noScope = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(noScope?.status, 400);
    const scoped = await route?.handle({ headers: TENANT_HEADERS, params: {} }, c);
    assert.equal(scoped?.status, 200);
    assert.deepEqual((scoped?.body as { runs: unknown[] }).runs, []);
  });

  it('GET /api/audit/summary returns a tenant-scoped kind aggregation', async () => {
    const c = ctx();
    const first = {
      schema_version: '1' as const,
      seq: 0,
      prev_hash: null,
      hash: '',
      ts: '2026-05-17T10:00:00Z',
      run_id: 'summary-run',
      kind: 'info' as const,
      actor: { type: 'system' as const, id: 'summary-test' },
      payload: { message: 'tenant-visible' },
    };
    first.hash = eventHash(first);
    await c.store.appendEvent(first, { org: 'padosoft', project: 'demo' });
    const second = { ...first, seq: 1, hash: '', kind: 'finding_emitted' as const };
    second.hash = eventHash(second, first.hash);
    await c.store.appendEvent(second, { org: 'other-org', project: 'demo' });
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/audit/summary');
    const response = await route?.handle({ headers: TENANT_HEADERS, params: {} }, c);
    assert.equal(response?.status, 200);
    assert.deepEqual(response?.body, { summary: { total: 1, by_kind: { info: 1 } } });
  });

  it('GET /api/risk-coverage aggregates tenant-scoped scenario events', async () => {
    const c = ctx();
    await c.store.saveRisk(
      {
        id: 'risk-checkout',
        category: 'business_logic',
        title: 'Checkout integrity',
        severity: 'high',
        likelihood: 'likely',
        invariants: [{ id: 'inv-total', statement: 'total matches line items' }],
        owners: [],
        tags: [],
      },
      { org: 'padosoft', project: 'demo' },
    );
    await c.store.saveScenario(
      {
        schema_version: '1',
        id: 'checkout-total',
        title: 'Checkout total remains correct',
        risk_refs: ['risk-checkout'],
        invariant_refs: ['inv-total'],
        steps: [{ id: 'checkout', kind: 'http', with: {} }],
        oracles: [{ id: 'total', kind: 'http_status', with: { expected: 200 } }],
        preconditions: [],
        cleanup: [],
        tags: [],
      },
      { org: 'padosoft', project: 'demo' },
    );
    await c.store.saveRun({
      schema_version: '1',
      id: 'run-coverage-demo',
      started_at: '2026-09-16T10:00:00Z',
      finished_at: '2026-09-16T10:01:00Z',
      state: 'succeeded',
      org: 'padosoft',
      project: 'demo',
      profile: 'smoke',
      execution_mode: 'orchestrator',
      config_snapshot: {
        profile: 'smoke',
        execution_mode: 'orchestrator',
        packs: [],
        config_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
      totals: {
        scenarios: 1,
        findings: 0,
        probes: 1,
        llm_tokens_in: 0,
        llm_tokens_out: 0,
        llm_cost_usd: 0,
      },
      artifact_dir: '.aqa/runs/run-coverage-demo',
    });
    const event = {
      schema_version: '1',
      seq: 0,
      prev_hash: null,
      ts: '2026-09-16T10:01:00Z',
      run_id: 'run-coverage-demo',
      kind: 'oracle_evaluated',
      actor: { type: 'orchestrator', id: 'test' },
      scenario_id: 'checkout-total',
      payload: { oracle_id: 'total', passed: true },
    };
    await c.store.appendEvent({ ...event, hash: eventHash(event) });
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/risk-coverage');
    const missing = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(missing?.status, 400);
    const response = await route?.handle({ headers: TENANT_HEADERS, params: {} }, c);
    assert.equal(response?.status, 200);
    const coverage = (
      response?.body as { coverage: Array<{ risk_id: string; pass_rate_30d: number }> }
    ).coverage;
    assert.equal(coverage.length, 1);
    assert.equal(coverage[0]?.risk_id, 'risk-checkout');
    assert.equal(coverage[0]?.pass_rate_30d, 1);
  });

  it('fails closed when risk coverage reads a tampered audit chain', async () => {
    const c = ctx();
    await c.store.saveRisk(
      {
        id: 'risk-tampered-coverage',
        category: 'business_logic',
        title: 'Tampered coverage evidence',
        severity: 'high',
        likelihood: 'likely',
        invariants: [{ id: 'inv-tampered', statement: 'audit chain is intact' }],
        owners: [],
        tags: [],
      },
      { org: 'padosoft', project: 'demo' },
    );
    await c.store.saveRun({
      schema_version: '1',
      id: 'run-tampered-coverage',
      started_at: '2026-09-16T10:00:00Z',
      finished_at: '2026-09-16T10:01:00Z',
      state: 'succeeded',
      org: 'padosoft',
      project: 'demo',
      profile: 'smoke',
      execution_mode: 'orchestrator',
      config_snapshot: {
        profile: 'smoke',
        execution_mode: 'orchestrator',
        packs: [],
        config_hash: 'a'.repeat(64),
      },
      totals: {
        scenarios: 1,
        findings: 0,
        probes: 1,
        llm_tokens_in: 0,
        llm_tokens_out: 0,
        llm_cost_usd: 0,
      },
      artifact_dir: '.aqa/runs/run-tampered-coverage',
    });
    await c.store.appendEvent({
      schema_version: '1',
      seq: 0,
      prev_hash: null,
      hash: 'f'.repeat(64),
      ts: '2026-09-16T10:01:00Z',
      run_id: 'run-tampered-coverage',
      kind: 'oracle_evaluated',
      actor: { type: 'orchestrator', id: 'test' },
      scenario_id: 'checkout-total',
      payload: { oracle_id: 'total', passed: true },
    });
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/risk-coverage');
    const response = await route?.handle({ headers: TENANT_HEADERS, params: {} }, c);
    assert.equal(response?.status, 500);
    assert.deepEqual(response?.body, {
      error: 'run audit chain integrity verification failed',
      code: 'AUDIT_CHAIN_INVALID',
    });
  });

  it('POST /api/admin/migrate-legacy-configuration requires an explicit destination scope', async () => {
    const c = ctx();
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
    await c.store.saveProfile(profile);
    const route = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/admin/migrate-legacy-configuration',
    );
    const missing = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(missing?.status, 400);
    const migrated = await route?.handle({ headers: TENANT_HEADERS, params: {} }, c);
    assert.equal(migrated?.status, 200);
    assert.deepEqual(migrated?.body, { migrated: 1, skipped: 0, conflicts: [] });
    assert.equal(await c.store.loadProfile(profile.name), null);
    assert.deepEqual(
      await c.store.loadProfile(profile.name, { org: 'padosoft', project: 'demo' }),
      profile,
    );
  });

  it('publishes methodology artifacts only with a bound independent approval', async () => {
    const c = ctx({ verifyMethodologyProposal: async () => true });
    const session = makeApi().find((r) => r.method === 'GET' && r.path === '/api/session');
    assert.deepEqual((await session?.handle({ headers: TENANT_HEADERS, params: {} }, c))?.body, {
      user: { id: FAKE_USER.id, name: FAKE_USER.display_name, role: FAKE_USER.roles[0] },
    });
    const artifact = createMethodologyArtifactEnvelope({
      artifact_kind: 'attack_tree',
      artifact_id: 'checkout-tree',
      revision: 1,
      created_at: '2026-09-18T10:00:00.000Z',
      payload: METHODOLOGY_TREE,
    });
    const proposal = createMethodologyProposal({
      proposal_id: 'proposal-checkout-tree',
      artifact_kind: artifact.artifact_kind,
      artifact_id: artifact.artifact_id,
      artifact: artifact.payload,
      revision: artifact.revision,
      proposed_by: 'agent-1',
      proposed_at: '2026-09-18T10:01:00.000Z',
      source: 'agent',
    });
    const approval = {
      schema_version: '1' as const,
      approval_id: 'approval-checkout-tree',
      proposal_id: proposal.proposal_id,
      artifact_sha256: artifact.artifact_sha256,
      revision: artifact.revision,
      approved_by: FAKE_USER.id,
      approved_at: '2026-09-18T10:02:00.000Z',
    };
    const publish = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/methodology/artifacts',
    );
    const propose = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/methodology/proposals',
    );
    const invalidProposal = await propose?.handle(
      {
        headers: TENANT_HEADERS,
        params: {},
        body: {
          artifact,
          proposal: { ...proposal, proposal_id: 'proposal-invalid-status', status: 'approved' },
        },
      },
      c,
    );
    assert.equal(invalidProposal?.status, 400);
    const proposed = await propose?.handle(
      { headers: TENANT_HEADERS, params: {}, body: { artifact, proposal } },
      c,
    );
    assert.equal(proposed?.status, 201);
    const proposalList = makeApi().find(
      (r) => r.method === 'GET' && r.path === '/api/methodology/proposals',
    );
    const pendingProposals = await proposalList?.handle(
      { headers: TENANT_HEADERS, params: {}, query: { status: 'pending' } },
      c,
    );
    assert.equal((pendingProposals?.body as { proposals: unknown[] }).proposals.length, 1);
    assert.equal(
      Object.hasOwn(
        (pendingProposals?.body as { proposals: Array<Record<string, unknown>> }).proposals[0],
        'artifact',
      ),
      false,
    );
    const proposalDetail = makeApi().find(
      (r) => r.method === 'GET' && r.path === '/api/methodology/proposals/:id',
    );
    const detail = await proposalDetail?.handle(
      { headers: TENANT_HEADERS, params: { id: proposal.proposal_id } },
      c,
    );
    assert.deepEqual(
      (detail?.body as { proposal: { artifact: unknown } }).proposal.artifact,
      artifact,
    );
    const invalidProposalStatus = await proposalList?.handle(
      { headers: TENANT_HEADERS, params: {}, query: { status: 'invalid' } },
      c,
    );
    assert.equal(invalidProposalStatus?.status, 400);
    const crossTenantProposals = await proposalList?.handle(
      { headers: { 'x-aqa-org': 'other', 'x-aqa-project': 'demo' }, params: {} },
      c,
    );
    assert.equal((crossTenantProposals?.body as { proposals: unknown[] }).proposals.length, 0);
    const approve = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/methodology/proposals/:id/approve',
    );
    const reject = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/methodology/proposals/:id/reject',
    );
    const rejectedProposal = { ...proposal, proposal_id: 'proposal-checkout-tree-rejected' };
    const rejectedProposalResponse = await propose?.handle(
      { headers: TENANT_HEADERS, params: {}, body: { artifact, proposal: rejectedProposal } },
      c,
    );
    assert.equal(rejectedProposalResponse?.status, 201);
    const rejectedResponse = await reject?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: rejectedProposal.proposal_id },
        body: {
          schema_version: '1',
          rejection_id: 'rejection-checkout-tree',
          proposal_id: rejectedProposal.proposal_id,
          rejected_by: FAKE_USER.id,
          rejected_at: '2026-09-18T10:02:00.000Z',
          reason: 'The generated tree omits the provider callback invariant.',
        },
      },
      c,
    );
    assert.equal(rejectedResponse?.status, 200);
    const rejectedProposals = await proposalList?.handle(
      { headers: TENANT_HEADERS, params: {}, query: { status: 'rejected' } },
      c,
    );
    assert.equal((rejectedProposals?.body as { proposals: unknown[] }).proposals.length, 1);
    const approved = await approve?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: proposal.proposal_id },
        body: approval,
      },
      c,
    );
    assert.equal(approved?.status, 200);
    const approvedProposals = await proposalList?.handle(
      { headers: TENANT_HEADERS, params: {}, query: { status: 'approved' } },
      c,
    );
    assert.equal((approvedProposals?.body as { proposals: unknown[] }).proposals.length, 1);
    const response = await publish?.handle(
      {
        headers: TENANT_HEADERS,
        params: {},
        body: { artifact, proposal_id: proposal.proposal_id },
      },
      c,
    );
    assert.equal(response?.status, 201);
    assert.equal((response?.body as { durability: string }).durability, 'ephemeral');
    assert.equal((response?.body as { lifecycle: { state: string } }).lifecycle.state, 'active');
    const lifecycleRoute = makeApi().find(
      (r) => r.method === 'GET' && r.path === '/api/methodology/artifacts/:id/:revision/lifecycle',
    );
    const lifecycleResponse = await lifecycleRoute?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: artifact.artifact_id, revision: String(artifact.revision) },
      },
      c,
    );
    assert.equal(
      (lifecycleResponse?.body as { lifecycle: { state: string } }).lifecycle.state,
      'active',
    );
    const legalHold = makeApi().find(
      (r) =>
        r.method === 'POST' && r.path === '/api/methodology/artifacts/:id/:revision/legal-hold',
    );
    const held = await legalHold?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: artifact.artifact_id, revision: String(artifact.revision) },
        body: { enabled: true, reason: 'Preserve evidence for operator review' },
      },
      c,
    );
    assert.equal((held?.body as { lifecycle: { legal_hold: boolean } }).lifecycle.legal_hold, true);
    const archive = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/methodology/artifacts/:id/:revision/archive',
    );
    const blockedArchive = await archive?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: artifact.artifact_id, revision: String(artifact.revision) },
        body: { reason: 'This must be blocked while held' },
      },
      c,
    );
    assert.equal(blockedArchive?.status, 409);
    const released = await legalHold?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: artifact.artifact_id, revision: String(artifact.revision) },
        body: { enabled: false, reason: 'Operator review completed' },
      },
      c,
    );
    assert.equal(
      (released?.body as { lifecycle: { legal_hold: boolean } }).lifecycle.legal_hold,
      false,
    );
    const archived = await archive?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: artifact.artifact_id, revision: String(artifact.revision) },
        body: { reason: 'Superseded by a reviewed revision' },
      },
      c,
    );
    assert.equal((archived?.body as { lifecycle: { state: string } }).lifecycle.state, 'archived');
    const list = makeApi().find(
      (r) => r.method === 'GET' && r.path === '/api/methodology/artifacts',
    );
    const listed = await list?.handle({ headers: TENANT_HEADERS, params: {} }, c);
    assert.equal((listed?.body as { artifacts: unknown[] }).artifacts.length, 1);
    const filtered = await list?.handle(
      { headers: TENANT_HEADERS, params: { kind: 'attack_tree' } },
      c,
    );
    assert.equal((filtered?.body as { artifacts: unknown[] }).artifacts.length, 1);
    const invalidFilter = await list?.handle(
      { headers: TENANT_HEADERS, params: { kind: 'not-a-kind' } },
      c,
    );
    assert.equal(invalidFilter?.status, 400);
    const crossTenant = await list?.handle(
      { headers: { 'x-aqa-org': 'other', 'x-aqa-project': 'demo' }, params: {} },
      c,
    );
    assert.equal((crossTenant?.body as { artifacts: unknown[] }).artifacts.length, 0);

    const replay = await publish?.handle(
      {
        headers: TENANT_HEADERS,
        params: {},
        body: { artifact, proposal_id: proposal.proposal_id },
      },
      c,
    );
    assert.equal(replay?.status, 201);
    assert.equal((replay?.body as { lifecycle: { state: string } }).lifecycle.state, 'archived');

    const forged = {
      ...approval,
      approval_id: 'approval-forged',
      approved_by: 'other-reviewer',
    };
    const rejected = await approve?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: proposal.proposal_id },
        body: { ...forged, secret: 'token=must-not-persist' },
      },
      c,
    );
    assert.equal(rejected?.status, 400);

    const conflictingArtifact = createMethodologyArtifactEnvelope({
      ...artifact,
      payload: {
        ...METHODOLOGY_TREE,
        children: [
          { id: 'checkout-payment', kind: 'leaf' as const, statement: 'Payment is captured once' },
        ],
      },
    });
    const conflictingProposal = createMethodologyProposal({
      proposal_id: 'proposal-conflicting-tree',
      artifact_kind: conflictingArtifact.artifact_kind,
      artifact_id: conflictingArtifact.artifact_id,
      artifact: conflictingArtifact.payload,
      revision: conflictingArtifact.revision,
      proposed_by: proposal.proposed_by,
      proposed_at: proposal.proposed_at,
      source: proposal.source,
    });
    assert.equal(
      (
        await propose?.handle(
          {
            headers: TENANT_HEADERS,
            params: {},
            body: { artifact: conflictingArtifact, proposal: conflictingProposal },
          },
          c,
        )
      )?.status,
      201,
    );
    assert.equal(
      (
        await approve?.handle(
          {
            headers: TENANT_HEADERS,
            params: { id: conflictingProposal.proposal_id },
            body: {
              ...approval,
              approval_id: 'approval-conflicting-tree',
              proposal_id: conflictingProposal.proposal_id,
              artifact_sha256: conflictingArtifact.artifact_sha256,
            },
          },
          c,
        )
      )?.status,
      200,
    );
    const conflict = await publish?.handle(
      {
        headers: TENANT_HEADERS,
        params: {},
        body: {
          artifact: conflictingArtifact,
          proposal_id: conflictingProposal.proposal_id,
        },
      },
      c,
    );
    assert.equal(conflict?.status, 409);
  });

  it('GET /api/runs/:id 404s when missing', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/runs/:id');
    const res = await route?.handle({ headers: TENANT_HEADERS, params: { id: 'nope' } }, c);
    assert.equal(res?.status, 404);
  });

  it('GET /api/runs/:id requires tenant scope', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/runs/:id');
    const res = await route?.handle({ headers: {}, params: { id: 'any' } }, c);
    assert.equal(res?.status, 400);
  });

  it('GET /api/runs/:id/events refuses a tampered audit chain', async () => {
    const c = ctx();
    await c.store.saveRun({
      schema_version: '1',
      id: 'run-events-integrity',
      started_at: '2026-09-16T10:00:00Z',
      finished_at: '2026-09-16T10:01:00Z',
      state: 'succeeded',
      org: 'padosoft',
      project: 'demo',
      profile: 'smoke',
      execution_mode: 'orchestrator',
      config_snapshot: {
        profile: 'smoke',
        execution_mode: 'orchestrator',
        packs: [],
        config_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
      totals: {
        scenarios: 1,
        findings: 0,
        probes: 0,
        llm_tokens_in: 0,
        llm_tokens_out: 0,
        llm_cost_usd: 0,
      },
      artifact_dir: '.aqa/runs/run-events-integrity',
    });
    const event = {
      schema_version: '1' as const,
      seq: 0,
      prev_hash: null,
      hash: '0'.repeat(64),
      ts: '2026-09-16T10:00:00Z',
      run_id: 'run-events-integrity',
      kind: 'run_started' as const,
      actor: { type: 'orchestrator' as const, id: 'test' },
      payload: {},
    };
    await c.store.appendEvent(event);
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/runs/:id/events');
    const res = await route?.handle(
      { headers: TENANT_HEADERS, params: { id: 'run-events-integrity' } },
      c,
    );
    assert.equal(res?.status, 500);
    assert.deepEqual(res?.body, {
      error: 'run audit chain integrity verification failed',
      code: 'AUDIT_CHAIN_INVALID',
    });
  });

  it('POST /api/runs enqueues a job', async () => {
    const events: unknown[] = [];
    const c = ctx({ eventBus: { publish: async (event) => events.push(event) } });
    const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/runs');
    const res = await route?.handle(
      { headers: TENANT_HEADERS, params: {}, body: { profile: 'smoke', priority: 5 } },
      c,
    );
    assert.equal(res?.status, 202);
    assert.equal(c.queue.size(), 1);
    assert.equal(c.queue.snapshot()[0]?.priority, 5);
    assert.equal((events[0] as { type: string }).type, 'run.requested');
  });

  it('POST /api/runs rejects fields outside the worker request contract', async () => {
    const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/runs');
    const response = await route?.handle(
      { headers: TENANT_HEADERS, params: {}, body: { profile: 'smoke', root: 'C:/unsafe' } },
      ctx(),
    );
    assert.equal(response?.status, 400);
    assert.match(String((response?.body as { error?: string }).error), /Unrecognized key|root/i);
  });

  it('POST /api/runs/:id/cancel is tenant-scoped and fences the queued job', async () => {
    const events: unknown[] = [];
    const c = ctx({ eventBus: { publish: async (event) => events.push(event) } });
    const create = makeApi().find((r) => r.method === 'POST' && r.path === '/api/runs');
    const created = await create?.handle(
      { headers: TENANT_HEADERS, params: {}, body: { profile: 'smoke' } },
      c,
    );
    const jobId = (created?.body as { job: { id: string } }).job.id;
    const cancel = makeApi().find((r) => r.method === 'POST' && r.path === '/api/runs/:id/cancel');
    const denied = await cancel?.handle(
      {
        headers: { 'x-aqa-org': 'other', 'x-aqa-project': 'demo' },
        params: { id: jobId },
        body: {},
      },
      c,
    );
    assert.equal(denied?.status, 404);
    const cancelled = await cancel?.handle(
      { headers: TENANT_HEADERS, params: { id: jobId }, body: { reason: 'operator stop' } },
      c,
    );
    assert.equal(cancelled?.status, 200);
    assert.equal(c.queue.snapshot()[0]?.status, 'cancelled');
    assert.equal((events.at(-1) as { type: string }).type, 'run.cancelled');
  });

  it('POST /api/runs requires tenant scope and deduplicates retries', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/runs');
    const missingScope = await route?.handle(
      { headers: {}, params: {}, body: { profile: 'smoke' } },
      c,
    );
    assert.equal(missingScope?.status, 400);
    const headers = { ...TENANT_HEADERS, 'Idempotency-Key': 'checkout-like-run-1' };
    const first = await route?.handle({ headers, params: {}, body: { profile: 'smoke' } }, c);
    const retry = await route?.handle({ headers, params: {}, body: { profile: 'smoke' } }, c);
    assert.equal(first?.status, 202);
    assert.equal(retry?.status, 202);
    assert.equal(
      (first?.body as { job: { id: string } }).job.id,
      (retry?.body as { job: { id: string } }).job.id,
    );
    assert.equal(c.queue.size(), 1);
    const conflict = await route?.handle(
      { headers, params: {}, body: { profile: 'release-gate' } },
      c,
    );
    assert.equal(conflict?.status, 409);
  });

  it('POST /api/runs returns a bounded 429 when tenant admission is full', async () => {
    const c = ctx({ quota: { concurrent_runs_max: 1 } });
    const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/runs');
    const first = await route?.handle(
      { headers: TENANT_HEADERS, params: {}, body: { profile: 'smoke' } },
      c,
    );
    const second = await route?.handle(
      { headers: TENANT_HEADERS, params: {}, body: { profile: 'release' } },
      c,
    );
    assert.equal(first?.status, 202);
    assert.equal(second?.status, 429);
    assert.deepEqual(second?.body, {
      error: '[server/queue] resource quota exceeded: concurrent_runs_max',
      code: 'RESOURCE_QUOTA_EXCEEDED',
      quota: 'concurrent_runs_max',
      limit: 1,
      current: 1,
      requested: 1,
    });
  });

  it('applies the API idempotency contract to non-run mutations', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/orgs');
    const headers = { ...TENANT_HEADERS, 'Idempotency-Key': 'org-create-1' };
    const body = { id: 'org-1', name: 'Acme' };
    const first = await route?.handle({ headers, params: {}, body }, c);
    const retry = await route?.handle({ headers, params: {}, body }, c);
    assert.equal(first?.status, 201);
    assert.deepEqual(retry, first);
    assert.deepEqual(await c.store.listOrgs(), [{ id: 'org-1', name: 'Acme' }]);
    const conflict = await route?.handle(
      { headers, params: {}, body: { id: 'org-1', name: 'Other' } },
      c,
    );
    assert.equal(conflict?.status, 409);
    const invalid = await route?.handle(
      { headers: { ...TENANT_HEADERS, 'Idempotency-Key': ' ' }, params: {}, body },
      c,
    );
    assert.equal(invalid?.status, 400);
  });

  it('coalesces concurrent idempotent operations and does not cache 5xx responses', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = new MemoryApiIdempotencyStore();
    const operation = {
      scope: 'org/project:POST:/api/orgs',
      key: 'concurrent-1',
      fingerprint: 'a',
    };
    const first = store.execute(operation, async () => {
      calls += 1;
      await gate;
      return { status: 201, body: { ok: true } };
    });
    const second = store.execute(operation, async () => {
      calls += 1;
      return { status: 201, body: { ok: false } };
    });
    release();
    assert.deepEqual(await Promise.all([first, second]), [
      { status: 201, body: { ok: true } },
      { status: 201, body: { ok: true } },
    ]);
    assert.equal(calls, 1);
    const retry = await store.execute(operation, async () => ({
      status: 500,
      body: { ok: false },
    }));
    assert.equal(retry.status, 201);
    const serverErrorStore = new MemoryApiIdempotencyStore();
    let failures = 0;
    const failing = () => {
      failures += 1;
      return Promise.resolve({ status: 503, body: { error: 'temporary' } });
    };
    await serverErrorStore.execute(operation, failing);
    await serverErrorStore.execute(operation, failing);
    assert.equal(failures, 2);
  });

  it('GET /api/runner/jobs/next pops from the queue', async () => {
    const c = ctx();
    c.queue.enqueue({ id: 'job-1', payload: {}, enqueued_at: '2026-05-17T10:00:00Z' });
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/runner/jobs/next');
    const res = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(res?.status, 200);
  });

  it('GET /api/runner/jobs/next returns 204 when no jobs', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/runner/jobs/next');
    const res = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(res?.status, 204);
  });

  it('POST /api/runner/jobs/:id/ack closes only the current lease token', async () => {
    const c = ctx();
    c.queue.enqueue({ id: 'job-ack', payload: {}, enqueued_at: '2026-05-17T10:00:00Z' });
    const next = await c.queue.dequeue();
    const route = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/runner/jobs/:id/ack',
    );
    assert.ok(route);
    const stale = await route.handle(
      { headers: {}, params: { id: 'job-ack' }, body: { lease_token: 'stale' } },
      c,
    );
    assert.equal(stale.status, 409);
    const ok = await route.handle(
      { headers: {}, params: { id: 'job-ack' }, body: { lease_token: next?.lease_token } },
      c,
    );
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { acknowledged: true });
  });

  it('POST /api/runner/jobs/:id/fail records a bounded failure', async () => {
    const c = ctx();
    c.queue.enqueue({ id: 'job-fail', payload: {}, enqueued_at: '2026-05-17T10:00:00Z' });
    const next = await c.queue.dequeue();
    const route = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/runner/jobs/:id/fail',
    );
    assert.ok(route);
    const res = await route.handle(
      {
        headers: {},
        params: { id: 'job-fail' },
        body: { lease_token: next?.lease_token, reason: 'provider timeout' },
      },
      c,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { failed: true });
    assert.equal((await c.queue.snapshot()).find((job) => job.id === 'job-fail')?.status, 'failed');
  });

  it('runner-only queue routes enforce the optional runner credential verifier', async () => {
    const c = {
      ...ctx(),
      runnerAuthorize: async (headers: Record<string, string>) =>
        headers.authorization === 'Bearer runner-test',
    };
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/runner/jobs/next');
    assert.ok(route);
    assert.equal((await route.handle({ headers: {}, params: {} }, c)).status, 401);
    assert.equal(
      (await route.handle({ headers: { authorization: 'Bearer runner-test' }, params: {} }, c))
        .status,
      204,
    );
  });

  it('runner authorization scopes dequeue and ACK to the declared tenant project', async () => {
    const c = ctx({
      runnerAuthorize: async () => ({
        runner_id: 'runner-shop',
        scopes: [{ org: 'padosoft', project: 'shop' }],
      }),
    });
    c.queue.enqueue({
      id: 'shop-job',
      payload: { org: 'padosoft', project: 'shop' },
      enqueued_at: '2026-05-17T10:00:00Z',
    });
    c.queue.enqueue({
      id: 'other-job',
      payload: { org: 'other', project: 'shop' },
      enqueued_at: '2026-05-17T10:01:00Z',
    });
    const nextRoute = makeApi().find(
      (r) => r.method === 'GET' && r.path === '/api/runner/jobs/next',
    );
    const ackRoute = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/runner/jobs/:id/ack',
    );
    assert.ok(nextRoute && ackRoute);
    const next = await nextRoute.handle({ headers: {}, params: {} }, c);
    assert.equal((next.body as { job: { id: string } }).job.id, 'shop-job');
    const crossTenant = await ackRoute.handle(
      { headers: {}, params: { id: 'other-job' }, body: { lease_token: 'unknown' } },
      c,
    );
    assert.equal(crossTenant.status, 404);
  });

  it('runner identity fences lease mutation even inside the same project scope', async () => {
    let identity = 'runner-a';
    const c = ctx({
      runnerAuthorize: async () => ({
        runner_id: identity,
        scopes: [{ org: 'padosoft', project: 'shop' }],
      }),
    });
    c.queue.enqueue({
      id: 'identity-job',
      payload: { org: 'padosoft', project: 'shop' },
      enqueued_at: '2026-05-17T10:00:00Z',
    });
    const nextRoute = makeApi().find(
      (r) => r.method === 'GET' && r.path === '/api/runner/jobs/next',
    );
    const ackRoute = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/runner/jobs/:id/ack',
    );
    assert.ok(nextRoute && ackRoute);
    const next = await nextRoute.handle({ headers: {}, params: {} }, c);
    const token = (next.body as { job: { lease_token?: string } }).job.lease_token;
    identity = 'runner-b';
    const rejected = await ackRoute.handle(
      { headers: {}, params: { id: 'identity-job' }, body: { lease_token: token } },
      c,
    );
    assert.equal(rejected.status, 409);
  });

  it('GET /api/queue snapshots the queue', async () => {
    const c = ctx();
    c.queue.enqueue({ id: 'job-a', payload: {}, enqueued_at: '2026-05-18T00:00:00Z' });
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/queue');
    const res = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(res?.status, 200);
    assert.equal((res?.body as { jobs: unknown[] }).jobs.length, 1);
  });

  it('GET /api/cost/summary requires tenant scope and computes a window', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/cost/summary');
    const noScope = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(noScope?.status, 400);
    const ok = await route?.handle({ headers: TENANT_HEADERS, params: {} }, c);
    assert.equal(ok?.status, 200);
    assert.ok((ok?.body as { summary: { total_usd: number } }).summary);
  });

  it('GET/POST /api/cost/halt is scoped, authorized and fail-closed without a controller', async () => {
    const calls: Array<[string, string]> = [];
    const reasons = new Map<string, string>();
    const c = ctx({
      budgetControl: {
        async halt(key, reason) {
          calls.push([key, reason]);
          reasons.set(key, reason);
        },
        async getHaltReason(key) {
          return reasons.get(key) ?? null;
        },
      },
    });
    const get = makeApi().find((r) => r.method === 'GET' && r.path === '/api/cost/halt');
    const post = makeApi().find((r) => r.method === 'POST' && r.path === '/api/cost/halt');
    assert.equal((await get?.handle({ headers: {}, params: {} }, c))?.status, 400);
    assert.equal(
      (await post?.handle({ headers: TENANT_HEADERS, params: {}, body: {} }, c))?.status,
      400,
    );
    assert.equal(
      (await post?.handle({ headers: TENANT_HEADERS, params: {}, body: { reason: 'incident' } }, c))
        ?.status,
      202,
    );
    assert.deepEqual(calls, [['padosoft/demo', 'incident']]);
    assert.deepEqual((await get?.handle({ headers: TENANT_HEADERS, params: {} }, c))?.body, {
      halted: true,
      reason: 'incident',
    });
    assert.equal((await get?.handle({ headers: TENANT_HEADERS, params: {} }, ctx()))?.status, 503);
  });

  it('GET /api/notifications requires x-aqa-org', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/notifications');
    const bad = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(bad?.status, 400);
    const ok = await route?.handle({ headers: { 'x-aqa-org': 'padosoft' }, params: {} }, c);
    assert.equal(ok?.status, 200);
  });

  it('GET /api/saved-views requires tenant + surface', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/saved-views');
    const bad = await route?.handle({ headers: TENANT_HEADERS, params: {} }, c);
    assert.equal(bad?.status, 400);
    const ok = await route?.handle({ headers: TENANT_HEADERS, params: { surface: 'runs' } }, c);
    assert.equal(ok?.status, 200);
  });

  it('POST /api/findings/:id/status requires status + reason in body', async () => {
    const c = ctx();
    const route = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/findings/:id/status',
    );
    const bad = await route?.handle({ headers: {}, params: { id: 'f-1' }, body: {} }, c);
    assert.equal(bad?.status, 400);
  });

  it('POST /api/findings/:id/status rejects unproven verified state', async () => {
    const c = ctx();
    await c.store.saveRun({
      schema_version: '1',
      id: 'run-status',
      started_at: '2026-05-17T10:00:00Z',
      finished_at: '2026-05-17T10:01:00Z',
      state: 'succeeded',
      org: 'padosoft',
      project: 'demo',
      profile: 'smoke',
      execution_mode: 'orchestrator',
      config_snapshot: {
        profile: 'smoke',
        execution_mode: 'orchestrator',
        packs: [],
        config_hash: 'a'.repeat(64),
      },
      totals: {
        scenarios: 1,
        findings: 1,
        probes: 1,
        llm_tokens_in: 0,
        llm_tokens_out: 0,
        llm_cost_usd: 0,
      },
      artifact_dir: '.aqa/runs/run-status',
    });
    await c.store.appendFinding({
      schema_version: '1',
      id: 'AQA-2026-9001',
      run_id: 'run-status',
      scenario_id: 'scenario-status',
      risk_id: 'risk-status',
      title: 'A finding that needs proof',
      summary: 'A sufficiently long finding summary',
      severity: 'high',
      status: 'draft',
      execution_mode: 'orchestrator',
      discovered_at: '2026-05-17T10:00:00Z',
      confidence: 0.5,
      confidence_components: {},
      failure_fingerprint: 'b'.repeat(64),
      reproducibility: {},
      verification_floor: 'scenario_level',
      evidence: [],
      tags: [],
    });
    const route = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/findings/:id/status',
    );
    const res = await route?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: 'AQA-2026-9001' },
        body: { status: 'verified', reason: 'Review without a deterministic replay' },
      },
      c,
    );
    assert.equal(res?.status, 400);
    assert.equal((await c.store.loadFinding('AQA-2026-9001'))?.status, 'draft');
    assert.equal((await c.store.listAuditEvents({})).length, 0);
  });

  it('POST /api/findings/:id/status persists a valid transition and audit event', async () => {
    const c = ctx();
    await c.store.saveRun({
      schema_version: '1',
      id: 'run-status-ok',
      started_at: '2026-05-17T10:00:00Z',
      finished_at: '2026-05-17T10:01:00Z',
      state: 'succeeded',
      org: 'padosoft',
      project: 'demo',
      profile: 'smoke',
      execution_mode: 'orchestrator',
      config_snapshot: {
        profile: 'smoke',
        execution_mode: 'orchestrator',
        packs: [],
        config_hash: 'b'.repeat(64),
      },
      totals: {
        scenarios: 1,
        findings: 1,
        probes: 1,
        llm_tokens_in: 0,
        llm_tokens_out: 0,
        llm_cost_usd: 0,
      },
      artifact_dir: '.aqa/runs/run-status-ok',
    });
    await c.store.appendFinding({
      schema_version: '1',
      id: 'AQA-2026-9002',
      run_id: 'run-status-ok',
      scenario_id: 'scenario-status',
      risk_id: 'risk-status',
      title: 'A finding that can be rejected',
      summary: 'A sufficiently long finding summary',
      severity: 'high',
      status: 'draft',
      execution_mode: 'orchestrator',
      discovered_at: '2026-05-17T10:00:00Z',
      confidence: 0.5,
      confidence_components: {},
      failure_fingerprint: 'b'.repeat(64),
      reproducibility: {},
      verification_floor: 'scenario_level',
      evidence: [],
      tags: [],
    });
    const route = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/findings/:id/status',
    );
    const res = await route?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: 'AQA-2026-9002' },
        body: { status: 'rejected', reason: 'Reproduced as a false positive in staging' },
      },
      c,
    );
    assert.equal(res?.status, 200);
    assert.equal((await c.store.loadFinding('AQA-2026-9002'))?.status, 'rejected');
    const audit = await c.store.listAuditEvents({});
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.payload.action, 'finding_status_changed');
    assert.equal(audit[0]?.prev_hash, null);
  });

  it('POST /api/findings/:id/verification closes and reopens the finding lifecycle', async () => {
    const c = ctx();
    await c.store.saveRun({
      schema_version: '1',
      id: 'run-verification-loop',
      started_at: '2026-05-17T10:00:00Z',
      finished_at: '2026-05-17T10:01:00Z',
      state: 'succeeded',
      org: 'padosoft',
      project: 'demo',
      profile: 'smoke',
      execution_mode: 'orchestrator',
      config_snapshot: {
        profile: 'smoke',
        execution_mode: 'orchestrator',
        packs: [],
        config_hash: 'c'.repeat(64),
      },
      totals: {
        scenarios: 1,
        findings: 1,
        probes: 1,
        llm_tokens_in: 0,
        llm_tokens_out: 0,
        llm_cost_usd: 0,
      },
      artifact_dir: '.aqa/runs/run-verification-loop',
    });
    await c.store.appendFinding({
      schema_version: '1',
      id: 'AQA-2026-9003',
      run_id: 'run-verification-loop',
      scenario_id: 'scenario-verification',
      risk_id: 'risk-verification',
      title: 'A finding under verification',
      summary: 'A sufficiently long finding summary for lifecycle testing',
      severity: 'high',
      status: 'draft',
      execution_mode: 'orchestrator',
      discovered_at: '2026-05-17T10:00:00Z',
      confidence: 0.5,
      confidence_components: {},
      failure_fingerprint: 'b'.repeat(64),
      reproducibility: {},
      verification_floor: 'scenario_level',
      evidence: [],
      tags: [],
    });
    const route = makeApi().find(
      (r) => r.method === 'POST' && r.path === '/api/findings/:id/verification',
    );
    const fixed = await route?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: 'AQA-2026-9003' },
        body: {
          verification_id: 'verification-2026-9003',
          observed_at: '2026-05-17T10:10:00Z',
          outcome: 'fixed',
          attempts: 2,
          successes: 2,
          deterministic: true,
          evidence_path: '.aqa/runs/run-verification-loop/verification.json',
        },
      },
      c,
    );
    assert.equal(fixed?.status, 200);
    assert.equal((await c.store.loadFinding('AQA-2026-9003'))?.status, 'fixed');
    const regressed = await route?.handle(
      {
        headers: TENANT_HEADERS,
        params: { id: 'AQA-2026-9003' },
        body: {
          verification_id: 'verification-2026-9004',
          observed_at: '2026-05-24T10:10:00Z',
          outcome: 'reproduced',
          attempts: 2,
          successes: 2,
          deterministic: true,
          fingerprint: 'b'.repeat(64),
          expected_fingerprint: 'b'.repeat(64),
          evidence_path: '.aqa/runs/run-verification-loop/regression.json',
        },
      },
      c,
    );
    assert.equal(regressed?.status, 200);
    assert.equal((await c.store.loadFinding('AQA-2026-9003'))?.status, 'regressed');
  });

  it('GET /api/findings only returns findings whose run belongs to the requested project', async () => {
    const c = ctx();
    const run = {
      schema_version: '1' as const,
      id: 'run-tenant-findings',
      started_at: '2026-05-17T10:00:00Z',
      finished_at: '2026-05-17T10:01:00Z',
      state: 'succeeded' as const,
      org: 'padosoft',
      project: 'demo',
      profile: 'smoke',
      execution_mode: 'orchestrator' as const,
      config_snapshot: {
        profile: 'smoke',
        execution_mode: 'orchestrator' as const,
        packs: [],
        config_hash: 'c'.repeat(64),
      },
      totals: {
        scenarios: 1,
        findings: 1,
        probes: 1,
        llm_tokens_in: 0,
        llm_tokens_out: 0,
        llm_cost_usd: 0,
      },
      artifact_dir: '.aqa/runs/run-tenant-findings',
    };
    await c.store.saveRun(run);
    await c.store.appendFinding({
      schema_version: '1',
      id: 'AQA-2026-9010',
      run_id: run.id,
      scenario_id: 'scenario-tenant',
      risk_id: 'risk-tenant',
      title: 'Tenant-scoped finding',
      summary: 'A sufficiently long finding summary',
      severity: 'high',
      status: 'draft',
      execution_mode: 'orchestrator',
      discovered_at: '2026-05-17T10:00:00Z',
      confidence: 0.5,
      confidence_components: {},
      reproducibility: {},
      verification_floor: 'scenario_level',
      evidence: [],
      tags: [],
    });
    await c.store.saveRun({ ...run, id: 'run-tenant-foreign', org: 'other' });
    await c.store.appendFinding({
      schema_version: '1',
      id: 'AQA-2026-9011',
      run_id: 'run-tenant-foreign',
      scenario_id: 'scenario-tenant',
      risk_id: 'risk-tenant',
      title: 'Foreign tenant finding',
      summary: 'A sufficiently long finding summary',
      severity: 'high',
      status: 'draft',
      execution_mode: 'orchestrator',
      discovered_at: '2026-05-17T10:00:00Z',
      confidence: 0.5,
      confidence_components: {},
      reproducibility: {},
      verification_floor: 'scenario_level',
      evidence: [],
      tags: [],
    });
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/findings');
    const visible = await route?.handle({ headers: TENANT_HEADERS, params: {} }, c);
    const foreign = await route?.handle(
      { headers: { ...TENANT_HEADERS, 'x-aqa-project': 'other' }, params: {} },
      c,
    );
    assert.equal((visible?.body as { findings: unknown[] }).findings.length, 1);
    assert.equal((foreign?.body as { findings: unknown[] }).findings.length, 0);
  });

  it('GET /api/orgs returns empty list initially', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/orgs');
    const res = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(res?.status, 200);
    assert.deepEqual((res?.body as { orgs: unknown[] }).orgs, []);
  });

  it('exposes tenant-bound SCIM users with bearer authorization and soft delete', async () => {
    const c = ctx({
      scimAuthorize: async (headers) => headers.authorization === 'Bearer scim-test',
    });
    const headers = { 'x-aqa-org': 'scim-org', authorization: 'Bearer scim-test' };
    const create = makeApi().find((r) => r.method === 'POST' && r.path === '/scim/v2/Users');
    const list = makeApi().find((r) => r.method === 'GET' && r.path === '/scim/v2/Users');
    const detail = makeApi().find((r) => r.method === 'GET' && r.path === '/scim/v2/Users/:id');
    const patch = makeApi().find((r) => r.method === 'PATCH' && r.path === '/scim/v2/Users/:id');
    const remove = makeApi().find((r) => r.method === 'DELETE' && r.path === '/scim/v2/Users/:id');
    assert.equal((await create?.handle({ headers: {}, params: {}, body: {} }, c))?.status, 401);
    const created = await create?.handle(
      {
        headers,
        params: {},
        body: {
          userName: 'scim-user',
          displayName: 'SCIM User',
          emails: [{ value: 'scim@example.test', primary: true }],
          roles: [{ value: 'developer' }],
        },
      },
      c,
    );
    assert.equal(created?.status, 201);
    const id = (created?.body as { id: string }).id;
    assert.equal(
      (
        await patch?.handle(
          {
            headers,
            params: { id },
            body: { Operations: [{ op: 'replace', path: 'active', value: false }] },
          },
          c,
        )
      )?.status,
      200,
    );
    const afterPatch = await detail?.handle({ headers, params: { id } }, c);
    assert.equal((afterPatch?.body as { userName: string }).userName, 'scim-user');
    const listed = await list?.handle({ headers, params: {} }, c);
    assert.equal((listed?.body as { totalResults: number }).totalResults, 1);
    const filtered = await list?.handle(
      {
        headers,
        params: {},
        query: { filter: 'userName eq "scim-user"', startIndex: '1', count: '1' },
      },
      c,
    );
    assert.deepEqual(
      (filtered?.body as { Resources: Array<{ userName: string }> }).Resources.map(
        (u) => u.userName,
      ),
      ['scim-user'],
    );
    assert.equal((filtered?.body as { totalResults: number }).totalResults, 1);
    assert.equal(
      (
        await detail?.handle(
          { headers: { ...headers, 'x-aqa-org': 'other-org' }, params: { id } },
          c,
        )
      )?.status,
      404,
    );
    assert.equal((await remove?.handle({ headers, params: { id } }, c))?.status, 204);
  });

  // ============ v1.7 slice 4b — Pack import (admin "Import manifest") ============

  describe('POST /api/packs/import', () => {
    const VALID_YAML = `schema_version: "1"
name: pack-imported
version: 0.1.0
description: "An imported pack"
author: "Test"
license: Apache-2.0
applies_when:
  sut_type: [api]
templates: []
scenarios: []
risks: []
oracles: []
probes: []
`;
    it('parses YAML body, validates, and installs the manifest (201)', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/import');
      assert.ok(route, 'POST /api/packs/import must exist');
      const res = await route?.handle({ headers: {}, params: {}, body: { yaml: VALID_YAML } }, c);
      assert.equal(
        res?.status,
        201,
        `expected 201, got ${res?.status}: ${JSON.stringify(res?.body)}`,
      );
      const body = res?.body as { pack: { name: string; version: string } };
      assert.equal(body.pack.name, 'pack-imported');
      assert.equal(body.pack.version, '0.1.0');
      // And the store actually has it.
      const stored = await c.store.loadPack('pack-imported');
      assert.ok(stored);
    });

    it('rejects unsigned manifests when enterprise signature policy is enabled', async () => {
      const c = ctx({ packRequireSignature: true });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/import');
      const res = await route?.handle({ headers: {}, params: {}, body: { yaml: VALID_YAML } }, c);
      assert.equal(res?.status, 400);
      assert.equal((res?.body as { code: string }).code, 'EPACKSCAN');
      assert.match((res?.body as { error: string }).error, /supply-chain/i);
    });

    it('returns 400 on missing body.yaml (with code=EINVAL)', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/import');
      const res = await route?.handle({ headers: {}, params: {}, body: {} }, c);
      assert.equal(res?.status, 400);
      const body = res?.body as { error: string; code: string };
      assert.equal(body.code, 'EINVAL');
      assert.match(body.error, /yaml/i);
    });

    it('returns 400 on YAML that does not parse (code=EINVAL)', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/import');
      const res = await route?.handle(
        { headers: {}, params: {}, body: { yaml: 'this is: not\n  valid: [yaml' } },
        c,
      );
      assert.equal(res?.status, 400);
      const body = res?.body as { error: string; code: string };
      assert.match(body.error, /parse|yaml/i);
      assert.equal(body.code, 'EINVAL');
    });

    it('requires and verifies an operator-trusted Ed25519 pack signature', async () => {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const keyId = 'operator-key-1';
      const unsigned = {
        schema_version: '1' as const,
        name: 'pack-trusted',
        version: '0.1.0',
        description: 'Trusted pack',
        author: 'Test',
        license: 'Apache-2.0',
        applies_when: {},
        templates: [],
        scenarios: [],
        risks: [],
        oracles: [],
        probes: [],
      };
      const digest = manifestDigest(unsigned);
      const signature = sign(null, Buffer.from(digest, 'utf8'), privateKey).toString('base64url');
      const yaml = JSON.stringify({
        ...unsigned,
        signing: { sha256: digest, key_id: keyId, ed25519_signature: signature },
      });
      const c = ctx({
        packTrustedKeys: {
          [keyId]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        },
      });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/import');
      const accepted = await route?.handle({ headers: {}, params: {}, body: { yaml } }, c);
      assert.equal(accepted?.status, 201);
      const rejected = await route?.handle(
        { headers: {}, params: {}, body: { yaml: yaml.replace(signature, `${signature}x`) } },
        c,
      );
      assert.equal(rejected?.status, 400);
      assert.equal((rejected?.body as { code: string }).code, 'ESIGNATURE');
    });

    it('returns 400 on schema-invalid manifest (code=EINVAL, concise path:msg list)', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/import');
      // Missing required `name` field.
      const yaml = `schema_version: "1"\nversion: 0.1.0\ndescription: missing name\nauthor: X\nlicense: Apache-2.0\napplies_when: { sut_type: [api] }\ntemplates: []\nscenarios: []\nrisks: []\noracles: []\nprobes: []\n`;
      const res = await route?.handle({ headers: {}, params: {}, body: { yaml } }, c);
      assert.equal(res?.status, 400);
      const body = res?.body as { error: string; code: string };
      assert.match(body.error, /schema|name|required/i);
      assert.equal(body.code, 'EINVAL');
      // The improved error format walks Zod issues into `path: message`
      // pairs separated by `; ` — much more actionable than the default
      // multi-line Zod dump. Assert the format so a regression to the
      // verbose form is caught.
      assert.ok(
        !body.error.includes('\n') || body.error.split('\n').length <= 2,
        `error should be concise, got multi-line dump: ${body.error}`,
      );
    });

    it('rejects an unsigned shell pack at the import boundary', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/import');
      const yaml = VALID_YAML.replace('probes: []', 'probes: [probes/shell.yaml]');
      const res = await route?.handle({ headers: {}, params: {}, body: { yaml } }, c);
      assert.equal(res?.status, 400);
      const body = res?.body as { code: string; issues: Array<{ rule: string }> };
      assert.equal(body.code, 'EPACKSCAN');
      assert.ok(body.issues.some((issue) => issue.rule === 'unsigned-shell-pack'));
      assert.equal(await c.store.loadPack('pack-imported'), null);
    });

    it('returns 409 when a pack with that name already exists', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/import');
      const first = await route?.handle({ headers: {}, params: {}, body: { yaml: VALID_YAML } }, c);
      assert.equal(first?.status, 201);
      const second = await route?.handle(
        { headers: {}, params: {}, body: { yaml: VALID_YAML } },
        c,
      );
      assert.equal(second?.status, 409);
      assert.equal((second?.body as { code: string }).code, 'EEXIST');
    });

    it('overwrites an existing pack when force=true', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/import');
      await route?.handle({ headers: {}, params: {}, body: { yaml: VALID_YAML } }, c);
      const newer = VALID_YAML.replace('version: 0.1.0', 'version: 0.2.0');
      const res = await route?.handle(
        { headers: {}, params: {}, body: { yaml: newer, force: true } },
        c,
      );
      assert.equal(res?.status, 201);
      const stored = await c.store.loadPack('pack-imported');
      assert.equal(stored?.version, '0.2.0');
    });

    it('rejects non-boolean force with 400', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/import');
      const res = await route?.handle(
        { headers: {}, params: {}, body: { yaml: VALID_YAML, force: 'yes' } },
        c,
      );
      assert.equal(res?.status, 400);
      assert.match((res?.body as { error: string }).error, /force.*boolean/i);
    });

    it('requires the packs:install permission', () => {
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/import');
      assert.equal(route?.requires, 'packs:install');
    });
  });

  describe('POST /api/packs JSON safety boundary', () => {
    const manifest = {
      schema_version: '1' as const,
      name: 'json-pack',
      version: '0.1.0',
      description: 'JSON pack',
      author: 'Test',
      license: 'Apache-2.0',
      applies_when: { sut_type: ['api'] },
      templates: [],
      scenarios: [],
      risks: [],
      oracles: [],
      probes: [],
    };

    it('validates, scans, and rejects duplicate installs unless forced', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs');
      assert.ok(route);
      assert.equal(
        (await route.handle({ headers: {}, params: {}, body: manifest }, c)).status,
        201,
      );
      const duplicate = await route.handle({ headers: {}, params: {}, body: manifest }, c);
      assert.equal(duplicate.status, 409);
      assert.equal((duplicate.body as { code: string }).code, 'EEXIST');
      assert.equal(
        (await route.handle({ headers: {}, params: {}, body: { ...manifest, force: true } }, c))
          .status,
        201,
      );
    });

    it('rejects malformed and unsigned shell manifests before persistence', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs');
      assert.ok(route);
      const malformed = await route.handle({ headers: {}, params: {}, body: { name: 'bad' } }, c);
      assert.equal(malformed.status, 400);
      const shell = await route.handle(
        {
          headers: {},
          params: {},
          body: { ...manifest, name: 'shell-json', probes: ['probes/shell.yaml'] },
        },
        c,
      );
      assert.equal(shell.status, 400);
      assert.equal((shell.body as { code: string }).code, 'EPACKSCAN');
      assert.equal(await c.store.loadPack('shell-json'), null);
    });

    it('rejects a declared Sigstore bundle when no operator identity policy is configured', async () => {
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs');
      assert.ok(route);
      const signed = {
        ...manifest,
        name: 'sigstore-without-policy',
        signing: {
          sha256: manifestDigest({ ...manifest, name: 'sigstore-without-policy' }),
          sigstore_bundle: '{}',
        },
      };
      const res = await route.handle({ headers: {}, params: {}, body: signed }, ctx());
      assert.equal(res.status, 400);
      assert.equal((res.body as { code: string }).code, 'ESIGNATURE');
    });
  });

  // ============ v1.7 slice 4c.2 — PUT /api/profiles/:name validation ============

  describe('PUT /api/profiles/:name', () => {
    const validProfile = {
      schema_version: '1',
      name: 'smoke',
      execution_mode: 'orchestrator',
      llm_usage: [],
      llm_budget_usd: 10,
      parallelism: 4,
      require_deterministic_replay: false,
      packs: ['core', 'api'],
      tags: [],
    };

    it('persists a schema-conforming body whose name matches the path', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/profiles/:name');
      const res = await route?.handle(
        { headers: {}, params: { name: 'smoke' }, body: validProfile },
        c,
      );
      assert.equal(res?.status, 200);
      assert.equal((res?.body as { profile: { name: string } }).profile.name, 'smoke');
    });

    it('returns an ETag and rejects a stale If-Match before writing', async () => {
      const c = ctx();
      await c.store.saveProfile(validProfile);
      const get = makeApi().find((r) => r.method === 'GET' && r.path === '/api/profiles/:name');
      const put = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/profiles/:name');
      const snapshot = await get?.handle({ headers: {}, params: { name: 'smoke' } }, c);
      const etag = snapshot?.headers?.ETag;
      assert.ok(etag);
      await c.store.saveProfile({ ...validProfile, tags: ['server-edit'] });
      const stale = await put?.handle(
        {
          headers: { 'If-Match': etag },
          params: { name: 'smoke' },
          body: { ...validProfile, tags: ['client-edit'] },
        },
        c,
      );
      assert.equal(stale?.status, 412);
      assert.equal((stale?.body as { code: string }).code, 'PRECONDITION_FAILED');
      assert.deepEqual((await c.store.loadProfile('smoke'))?.tags, ['server-edit']);
    });

    it('rejects a body that fails Profile schema parsing (400)', async () => {
      // PR #30 iter 9 (Copilot): server must parse the Profile schema
      // before persisting; the admin UI's client-side validation is
      // not a trust boundary.
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/profiles/:name');
      // parallelism over the max=64 cap; the modal blocks this in
      // the UI but a stale bundle / curl would otherwise persist it.
      const bad = { ...validProfile, parallelism: 999 };
      const res = await route?.handle({ headers: {}, params: { name: 'smoke' }, body: bad }, c);
      assert.equal(res?.status, 400);
      assert.match((res?.body as { error: string }).error, /profile failed schema validation/i);
    });

    it('rejects a body whose name does not match the path (400)', async () => {
      // PR #30 iter 9 (Copilot): a body that names a different
      // profile would silently create-or-replace the body's name
      // instead of the path's. Reject the mismatch.
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/profiles/:name');
      const mismatched = { ...validProfile, name: 'attacker-owned' };
      const res = await route?.handle(
        { headers: {}, params: { name: 'smoke' }, body: mismatched },
        c,
      );
      assert.equal(res?.status, 400);
      assert.match(
        (res?.body as { error: string }).error,
        /name mismatch.*"smoke".*"attacker-owned"/i,
      );
    });

    it('404s when the path name is missing (matches GET/DELETE)', async () => {
      // PR #30 iter 10 (Copilot): the mismatch check was conditional
      // on `req.params.name`, so a body-only request would persist
      // `body.name` without any path identity — inconsistent with
      // the GET/DELETE profile handlers that 404 on missing names.
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/profiles/:name');
      const res = await route?.handle({ headers: {}, params: {}, body: validProfile }, c);
      assert.equal(res?.status, 404);
    });

    it('requires the profiles:edit permission', () => {
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/profiles/:name');
      assert.equal(route?.requires, 'profiles:edit');
    });
  });

  // ============ v1.7 slice 4c.3 — POST /api/profiles (Profile Clone) ============

  describe('POST /api/profiles', () => {
    const validProfile = {
      schema_version: '1',
      name: 'smoke-clone',
      execution_mode: 'orchestrator',
      llm_usage: [],
      llm_budget_usd: 10,
      parallelism: 4,
      require_deterministic_replay: false,
      packs: ['core', 'api'],
      tags: [],
    };

    it('creates a new profile with 201 when the name is unused', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/profiles');
      const res = await route?.handle({ headers: {}, params: {}, body: validProfile }, c);
      assert.equal(res?.status, 201);
      assert.equal((res?.body as { profile: { name: string } }).profile.name, 'smoke-clone');
      const stored = await c.store.loadProfile('smoke-clone');
      assert.equal(stored?.name, 'smoke-clone');
    });

    it('rejects a body that fails Profile schema parsing (400)', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/profiles');
      const bad = { ...validProfile, parallelism: -1 };
      const res = await route?.handle({ headers: {}, params: {}, body: bad }, c);
      assert.equal(res?.status, 400);
      assert.match((res?.body as { error: string }).error, /profile failed schema validation/i);
    });

    it('409s with code=EEXIST when a profile with that name already exists', async () => {
      // POST is strict "create-new" semantics; clones over an existing
      // name would silently overwrite the original via the upsert
      // saveProfile API, so the route delegates to the atomic
      // createProfile and rejects with 409 + EEXIST when it returns
      // { created: false }.
      const c = ctx();
      await c.store.saveProfile(validProfile);
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/profiles');
      const res = await route?.handle({ headers: {}, params: {}, body: validProfile }, c);
      assert.equal(res?.status, 409);
      assert.equal((res?.body as { code: string }).code, 'EEXIST');
      assert.match((res?.body as { error: string }).error, /already exists/i);
    });

    it('uses atomic createProfile so concurrent same-name POSTs do not both succeed', async () => {
      // Two concurrent POSTs for the same name must yield exactly one
      // 201 and one 409 — verifying the route doesn't fall back to a
      // load+save sequence that could race between the await points.
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/profiles');
      const [a, b] = await Promise.all([
        route?.handle({ headers: {}, params: {}, body: validProfile }, c),
        route?.handle({ headers: {}, params: {}, body: validProfile }, c),
      ]);
      const statuses = [a?.status, b?.status].sort();
      assert.deepEqual(statuses, [201, 409]);
    });

    it('allows the same profile name in separate tenant projects without leakage', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/profiles');
      const alpha = { ...TENANT_HEADERS, 'x-aqa-project': 'alpha' };
      const beta = { ...TENANT_HEADERS, 'x-aqa-project': 'beta' };
      const a = await route?.handle({ headers: alpha, params: {}, body: validProfile }, c);
      const b = await route?.handle(
        { headers: beta, params: {}, body: { ...validProfile, tags: ['beta'] } },
        c,
      );
      assert.equal(a?.status, 201);
      assert.equal(b?.status, 201);
      assert.deepEqual(
        (await c.store.loadProfile(validProfile.name, { org: 'padosoft', project: 'beta' }))?.tags,
        ['beta'],
      );
      const list = makeApi().find((r) => r.method === 'GET' && r.path === '/api/profiles');
      const alphaList = await list?.handle({ headers: alpha, params: {} }, c);
      assert.deepEqual(
        (alphaList?.body as { profiles: Array<{ tags: string[] }> }).profiles[0]?.tags,
        [],
      );
    });

    it('requires the profiles:edit permission', () => {
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/profiles');
      assert.equal(route?.requires, 'profiles:edit');
    });
  });

  // ============ v1.7 slice 4c.5 — PUT /api/risks/:id (Risk Edit) ============

  describe('PUT /api/risks/:id', () => {
    const validRisk = {
      id: 'risk-y',
      title: 'Some risk',
      category: 'auth' as const,
      severity: 'medium' as const,
      likelihood: 'possible' as const,
      invariants: [],
      owners: [],
      tags: [],
    };

    it('persists a schema-conforming body whose id matches the path', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/risks/:id');
      const res = await route?.handle(
        { headers: {}, params: { id: 'risk-y' }, body: validRisk },
        c,
      );
      assert.equal(res?.status, 200);
      const body = res?.body as { risk: { id: string } };
      assert.equal(body.risk.id, 'risk-y');
      const stored = await c.store.loadRisk('risk-y');
      assert.equal(stored?.id, 'risk-y');
    });

    it('rejects a body that fails Risk schema parsing (400)', async () => {
      // Trust boundary: the admin UI's inline validation is not a
      // server-side contract — a stale bundle/curl could otherwise
      // persist garbage. The Risk schema's `category` is a tight
      // enum; sending an off-enum value must 400.
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/risks/:id');
      const bad = { ...validRisk, category: 'not-a-category' };
      const res = await route?.handle({ headers: {}, params: { id: 'risk-y' }, body: bad }, c);
      assert.equal(res?.status, 400);
      assert.match((res?.body as { error: string }).error, /risk failed schema validation/i);
    });

    it('rejects a body whose id does not match the path (400)', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/risks/:id');
      const mismatched = { ...validRisk, id: 'attacker-owned' };
      const res = await route?.handle(
        { headers: {}, params: { id: 'risk-y' }, body: mismatched },
        c,
      );
      assert.equal(res?.status, 400);
      assert.match(
        (res?.body as { error: string }).error,
        /id mismatch.*"risk-y".*"attacker-owned"/i,
      );
    });

    it('404s when the path id is missing', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/risks/:id');
      const res = await route?.handle({ headers: {}, params: {}, body: validRisk }, c);
      assert.equal(res?.status, 404);
    });

    it('requires the risk-map:edit permission', () => {
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/risks/:id');
      assert.equal(route?.requires, 'risk-map:edit');
    });
  });

  // ============ v1.7 slice 4c.4 — DELETE /api/risks/:id (Risk Delete) ============

  describe('DELETE /api/risks/:id', () => {
    // Schema-conforming fixture: RiskCategory enum is the OWASP-ish
    // grouping (auth/data/...), Severity is the common shared enum,
    // and invariants are { id, statement } objects, NOT strings.
    // Title must be ≥ 4 chars per the schema. We don't include
    // schema_version on Risk (it lives on the outer RiskMap envelope).
    const validRisk = {
      id: 'risk-x',
      title: 'Test risk',
      category: 'auth' as const,
      severity: 'medium' as const,
      likelihood: 'possible' as const,
      invariants: [],
      owners: [],
      tags: [],
    };

    it('removes the risk from the store and returns { id, deleted: true }', async () => {
      const c = ctx();
      await c.store.saveRisk(validRisk);
      const route = makeApi().find((r) => r.method === 'DELETE' && r.path === '/api/risks/:id');
      const res = await route?.handle({ headers: {}, params: { id: 'risk-x' }, body: {} }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as { id: string; deleted: boolean };
      assert.equal(body.id, 'risk-x');
      assert.equal(body.deleted, true);
      const stillThere = await c.store.loadRisk('risk-x');
      assert.equal(stillThere, null);
    });

    it('404s when the path id is missing', async () => {
      // Mirrors the GET/PUT/DELETE profile handlers: a route without an
      // id is not a no-op delete, it's a malformed request.
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'DELETE' && r.path === '/api/risks/:id');
      const res = await route?.handle({ headers: {}, params: {}, body: {} }, c);
      assert.equal(res?.status, 404);
    });

    it('is idempotent — deleting a non-existent id still returns 200 with { id, deleted: true }', async () => {
      // REST DELETE semantics: an already-gone resource is the desired
      // state, so we don't 404. The admin UI treats 200 as success and
      // surfaces the toast either way. Locking in the response-body
      // contract here ensures the admin's correlate-by-id flow keeps
      // working even when the underlying store is missing the row.
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'DELETE' && r.path === '/api/risks/:id');
      const res = await route?.handle({ headers: {}, params: { id: 'nope' }, body: {} }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as { id: string; deleted: boolean };
      assert.equal(body.id, 'nope');
      assert.equal(body.deleted, true);
    });

    it('requires the risk-map:edit permission', () => {
      const route = makeApi().find((r) => r.method === 'DELETE' && r.path === '/api/risks/:id');
      assert.equal(route?.requires, 'risk-map:edit');
    });
  });

  // ============ v1.7 slice 4c.8 — POST /api/scenarios (Scenario Clone) ============

  describe('POST /api/scenarios', () => {
    const validScenario = {
      schema_version: '1' as const,
      id: 'sc-new',
      title: 'New scenario',
      risk_refs: ['risk-cross-tenant-leak'],
      invariant_refs: [],
      preconditions: [],
      steps: [{ id: 'probe-1', kind: 'http' as const, with: {}, timeout_ms: 30_000 }],
      oracles: [
        { id: 'oracle-1', kind: 'http_status' as const, with: { expected: 200 }, weight: 1 },
      ],
      cleanup: [],
      tags: [],
    };

    it('creates a new scenario with 201 when the id is unused', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/scenarios');
      const res = await route?.handle({ headers: {}, params: {}, body: validScenario }, c);
      assert.equal(res?.status, 201);
      assert.equal((res?.body as { scenario: { id: string } }).scenario.id, 'sc-new');
      const stored = await c.store.loadScenario('sc-new');
      assert.equal(stored?.id, 'sc-new');
    });

    it('rejects a body that fails Scenario schema parsing (400)', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/scenarios');
      const bad = { ...validScenario, oracles: [] };
      const res = await route?.handle({ headers: {}, params: {}, body: bad }, c);
      assert.equal(res?.status, 400);
      assert.match((res?.body as { error: string }).error, /scenario failed schema validation/i);
    });

    it('409s with code=EEXIST when a scenario with that id already exists', async () => {
      const c = ctx();
      await c.store.saveScenario(validScenario);
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/scenarios');
      const res = await route?.handle({ headers: {}, params: {}, body: validScenario }, c);
      assert.equal(res?.status, 409);
      assert.equal((res?.body as { code: string }).code, 'EEXIST');
    });

    it('uses atomic createScenario so concurrent same-id POSTs do not both succeed', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/scenarios');
      const [a, b] = await Promise.all([
        route?.handle({ headers: {}, params: {}, body: validScenario }, c),
        route?.handle({ headers: {}, params: {}, body: validScenario }, c),
      ]);
      const statuses = [a?.status, b?.status].sort();
      assert.deepEqual(statuses, [201, 409]);
    });

    it('requires the risk-map:edit permission', () => {
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/scenarios');
      assert.equal(route?.requires, 'risk-map:edit');
    });
  });

  // ============ v1.7 slice 4c.7 — PUT /api/scenarios/:id (Scenario Edit) ============

  describe('PUT /api/scenarios/:id', () => {
    const validScenario = {
      schema_version: '1' as const,
      id: 'sc-edit',
      title: 'Editable scenario',
      risk_refs: ['risk-cross-tenant-leak'],
      invariant_refs: [],
      preconditions: [],
      steps: [{ id: 'probe-1', kind: 'http' as const, with: {}, timeout_ms: 30_000 }],
      oracles: [
        { id: 'oracle-1', kind: 'http_status' as const, with: { expected: 200 }, weight: 1 },
      ],
      cleanup: [],
      tags: [],
    };

    it('persists a schema-conforming body whose id matches the path', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/scenarios/:id');
      const res = await route?.handle(
        { headers: {}, params: { id: 'sc-edit' }, body: validScenario },
        c,
      );
      assert.equal(res?.status, 200);
      assert.equal((res?.body as { scenario: { id: string } }).scenario.id, 'sc-edit');
    });

    it('rejects a body that fails Scenario schema parsing (400)', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/scenarios/:id');
      // Empty steps array fails the schema's min(1) on steps.
      const bad = { ...validScenario, steps: [] };
      const res = await route?.handle({ headers: {}, params: { id: 'sc-edit' }, body: bad }, c);
      assert.equal(res?.status, 400);
      assert.match((res?.body as { error: string }).error, /scenario failed schema validation/i);
    });

    it('rejects a body whose id does not match the path (400)', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/scenarios/:id');
      const mismatched = { ...validScenario, id: 'attacker-owned' };
      const res = await route?.handle(
        { headers: {}, params: { id: 'sc-edit' }, body: mismatched },
        c,
      );
      assert.equal(res?.status, 400);
      assert.match(
        (res?.body as { error: string }).error,
        /id mismatch.*"sc-edit".*"attacker-owned"/i,
      );
    });

    it('404s when the path id is missing', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/scenarios/:id');
      const res = await route?.handle({ headers: {}, params: {}, body: validScenario }, c);
      assert.equal(res?.status, 404);
    });

    it('requires the risk-map:edit permission', () => {
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/scenarios/:id');
      assert.equal(route?.requires, 'risk-map:edit');
    });
  });

  // ============ v1.7 slice 4c.6 — DELETE /api/scenarios/:id (Scenario Delete) ============

  describe('DELETE /api/scenarios/:id', () => {
    // Schema-conforming fixture matching @aqa/schemas Scenario:
    // includes the required schema_version/title/steps/oracles.
    const validScenario = {
      schema_version: '1' as const,
      id: 'sc-x',
      title: 'Verify cross-tenant isolation',
      risk_refs: ['risk-cross-tenant-leak'],
      invariant_refs: [],
      preconditions: [],
      steps: [{ id: 'probe-1', kind: 'http' as const, with: {}, timeout_ms: 30_000 }],
      oracles: [
        { id: 'oracle-1', kind: 'http_status' as const, with: { expected: 200 }, weight: 1 },
      ],
      cleanup: [],
      tags: [],
    };

    it('removes the scenario and returns { id, deleted: true }', async () => {
      const c = ctx();
      await c.store.saveScenario(validScenario);
      const route = makeApi().find((r) => r.method === 'DELETE' && r.path === '/api/scenarios/:id');
      const res = await route?.handle({ headers: {}, params: { id: 'sc-x' }, body: {} }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as { id: string; deleted: boolean };
      assert.equal(body.id, 'sc-x');
      assert.equal(body.deleted, true);
      assert.equal(await c.store.loadScenario('sc-x'), null);
    });

    it('404s when the path id is missing', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'DELETE' && r.path === '/api/scenarios/:id');
      const res = await route?.handle({ headers: {}, params: {}, body: {} }, c);
      assert.equal(res?.status, 404);
    });

    it('is idempotent — re-deleting a missing id still 200s with { id, deleted: true }', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'DELETE' && r.path === '/api/scenarios/:id');
      const res = await route?.handle({ headers: {}, params: { id: 'nope' }, body: {} }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as { id: string; deleted: boolean };
      assert.equal(body.id, 'nope');
      assert.equal(body.deleted, true);
    });

    it('requires the risk-map:edit permission', () => {
      const route = makeApi().find((r) => r.method === 'DELETE' && r.path === '/api/scenarios/:id');
      assert.equal(route?.requires, 'risk-map:edit');
    });
  });

  // ============ v1.7 slice 4g — Users & Roles ============

  describe('Users & Roles (slice 4g)', () => {
    const sampleUser = {
      id: 'usr-sara',
      email: 'sara@padosoft.com',
      display_name: 'Sara Conti',
      roles: ['admin' as const],
      status: 'active' as const,
      last_active_at: '2026-05-20T08:00:00Z',
    };

    it('GET /api/users returns the seeded directory snapshot', async () => {
      const c = ctx();
      (c.store as unknown as { __test_seedUser: (u: typeof sampleUser) => void }).__test_seedUser(
        sampleUser,
      );
      const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/users');
      const res = await route?.handle({ headers: {}, params: {} }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as { users: Array<{ id: string }> };
      assert.equal(body.users.length, 1);
      assert.equal(body.users[0]?.id, 'usr-sara');
    });

    it('GET /api/roles returns the rolePermissions matrix from @aqa/auth', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/roles');
      const res = await route?.handle({ headers: {}, params: {} }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as { roles: Array<{ role: string; permissions: string[] }> };
      const names = body.roles.map((r) => r.role).sort();
      assert.deepEqual(names, ['admin', 'developer', 'maintainer', 'viewer']);
      const adminRow = body.roles.find((r) => r.role === 'admin');
      assert.ok(adminRow?.permissions.includes('admin:everything'));
    });

    it('both routes require settings:read', () => {
      const api = makeApi();
      assert.equal(
        api.find((r) => r.method === 'GET' && r.path === '/api/users')?.requires,
        'settings:read',
      );
      assert.equal(
        api.find((r) => r.method === 'GET' && r.path === '/api/roles')?.requires,
        'settings:read',
      );
    });
  });

  describe('SSO config (slice 4h)', () => {
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
        'user.role': 'roles[0]',
      },
    };

    it('GET /api/sso/config returns null when unset', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/sso/config');
      const res = await route?.handle({ headers: {}, params: {} }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as { config: unknown };
      assert.equal(body.config, null);
    });

    it('GET /api/sso/config returns schema-validated config', async () => {
      const c = ctx();
      (
        c.store as unknown as { __test_seedSsoConfig: (cfg: typeof sampleConfig) => void }
      ).__test_seedSsoConfig(sampleConfig);
      const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/sso/config');
      const res = await route?.handle({ headers: {}, params: {} }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as { config: typeof sampleConfig | null };
      assert.deepEqual(body.config, sampleConfig);
    });

    it('GET /api/sso/config returns 500 on schema-invalid cached config', async () => {
      const c = ctx();
      (c.store as unknown as { __test_seedSsoConfig: (cfg: unknown) => void }).__test_seedSsoConfig(
        {
          schema_version: '1',
          provider: 'oidc',
          enabled: true,
          issuer_url: 'not-a-url',
          client_id: 'aqa-admin',
          client_secret_set: true,
          allowed_email_domains: ['example.com'],
          claim_mappings: { user: 'sub' },
        },
      );
      const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/sso/config');
      const res = await route?.handle({ headers: {}, params: {} }, c);
      assert.equal(res?.status, 500);
      const body = res?.body as { error: string };
      assert.match(body.error, /sso config failed schema validation/i);
    });

    it('requires settings:read', () => {
      const api = makeApi();
      assert.equal(
        api.find((r) => r.method === 'GET' && r.path === '/api/sso/config')?.requires,
        'settings:read',
      );
    });

    it('PUT /api/sso/config persists schema-valid config', async () => {
      const c = ctx();
      const putRoute = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/sso/config');
      const put = await putRoute?.handle({ headers: {}, params: {}, body: sampleConfig }, c);
      assert.equal(put?.status, 200);
      const body = put?.body as { config: typeof sampleConfig };
      assert.deepEqual(body.config, sampleConfig);

      const getRoute = makeApi().find((r) => r.method === 'GET' && r.path === '/api/sso/config');
      const get = await getRoute?.handle({ headers: {}, params: {} }, c);
      assert.equal(get?.status, 200);
      assert.deepEqual((get?.body as { config: typeof sampleConfig | null }).config, sampleConfig);
    });

    it('PUT /api/sso/config rejects schema-invalid body', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'PUT' && r.path === '/api/sso/config');
      const res = await route?.handle(
        {
          headers: {},
          params: {},
          body: {
            ...sampleConfig,
            issuer_url: 'not-a-url',
          },
        },
        c,
      );
      assert.equal(res?.status, 400);
      assert.match((res?.body as { error: string }).error, /schema validation/i);
    });

    it('PUT /api/sso/config requires settings:edit', () => {
      const api = makeApi();
      assert.equal(
        api.find((r) => r.method === 'PUT' && r.path === '/api/sso/config')?.requires,
        'settings:edit',
      );
    });
  });

  // ============ v1.7 slice 4d — Agents ============

  describe('Agents (slice 4d)', () => {
    const sampleAgent = {
      schema_version: '1' as const,
      id: 'claude',
      name: 'Claude Code',
      vendor: 'Anthropic',
      installed: false,
      last_updated: null,
      files: ['CLAUDE.md'],
    };

    it('GET /api/agents returns the seeded list', async () => {
      const c = ctx();
      (
        c.store as unknown as { __test_seedAgent: (a: typeof sampleAgent) => void }
      ).__test_seedAgent(sampleAgent);
      const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/agents');
      const res = await route?.handle({ headers: {}, params: {} }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as { agents: Array<{ id: string }> };
      assert.equal(body.agents.length, 1);
      assert.equal(body.agents[0]?.id, 'claude');
    });

    it('GET /api/agents/:id 404s when missing', async () => {
      const c = ctx();
      const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/agents/:id');
      const res = await route?.handle({ headers: {}, params: { id: 'nope' } }, c);
      assert.equal(res?.status, 404);
    });

    it('GET /api/agents/:id returns 200 with the seeded agent body', async () => {
      // PR #38 Copilot iter 7: the detail route only had a 404 test;
      // adding a success-path assertion guards against regressions
      // in the detail handler (e.g. accidentally returning the
      // wrong agent / a degenerate body).
      const c = ctx();
      (
        c.store as unknown as { __test_seedAgent: (a: typeof sampleAgent) => void }
      ).__test_seedAgent(sampleAgent);
      const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/agents/:id');
      const res = await route?.handle({ headers: {}, params: { id: 'claude' } }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as {
        agent: { id: string; installed: boolean; last_updated: string | null };
      };
      assert.equal(body.agent.id, 'claude');
      assert.equal(body.agent.installed, false);
      assert.equal(body.agent.last_updated, null);
    });

    it('POST /api/agents/:id/install flips installed=true and stamps last_updated', async () => {
      const c = ctx();
      (
        c.store as unknown as { __test_seedAgent: (a: typeof sampleAgent) => void }
      ).__test_seedAgent(sampleAgent);
      const route = makeApi().find(
        (r) => r.method === 'POST' && r.path === '/api/agents/:id/install',
      );
      const res = await route?.handle({ headers: {}, params: { id: 'claude' }, body: {} }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as { agent: { installed: boolean; last_updated: string | null } };
      assert.equal(body.agent.installed, true);
      assert.ok(body.agent.last_updated, 'last_updated must be stamped');
    });

    it('POST /api/agents/:id/uninstall flips installed=false (idempotent)', async () => {
      const c = ctx();
      (
        c.store as unknown as { __test_seedAgent: (a: typeof sampleAgent) => void }
      ).__test_seedAgent({
        ...sampleAgent,
        installed: true,
        last_updated: '2026-05-19T12:00:00Z',
      });
      const route = makeApi().find(
        (r) => r.method === 'POST' && r.path === '/api/agents/:id/uninstall',
      );
      const res = await route?.handle({ headers: {}, params: { id: 'claude' }, body: {} }, c);
      assert.equal(res?.status, 200);
      const body = res?.body as { agent: { installed: boolean; last_updated: string | null } };
      assert.equal(body.agent.installed, false);
      // last_updated is preserved as a record of when the agent was
      // last installed — useful in the admin's "last_updated" column.
      assert.equal(body.agent.last_updated, '2026-05-19T12:00:00Z');
    });

    it('install/uninstall 404 when the agent id is unknown', async () => {
      const c = ctx();
      const install = makeApi().find(
        (r) => r.method === 'POST' && r.path === '/api/agents/:id/install',
      );
      const uninstall = makeApi().find(
        (r) => r.method === 'POST' && r.path === '/api/agents/:id/uninstall',
      );
      assert.equal(
        (await install?.handle({ headers: {}, params: { id: 'nope' }, body: {} }, c))?.status,
        404,
      );
      assert.equal(
        (await uninstall?.handle({ headers: {}, params: { id: 'nope' }, body: {} }, c))?.status,
        404,
      );
    });

    it('install/uninstall require agents:edit; read requires agents:read', () => {
      const api = makeApi();
      assert.equal(
        api.find((r) => r.method === 'GET' && r.path === '/api/agents')?.requires,
        'agents:read',
      );
      // PR #38 Copilot iter 6: also assert the detail endpoint, so
      // an accidental relaxation of the per-id route doesn't slip
      // through under a permission stricter than the list.
      assert.equal(
        api.find((r) => r.method === 'GET' && r.path === '/api/agents/:id')?.requires,
        'agents:read',
      );
      assert.equal(
        api.find((r) => r.method === 'POST' && r.path === '/api/agents/:id/install')?.requires,
        'agents:edit',
      );
      assert.equal(
        api.find((r) => r.method === 'POST' && r.path === '/api/agents/:id/uninstall')?.requires,
        'agents:edit',
      );
    });
  });

  // ============ v1.7 slice 3 — Pack scaffolding (Admin Create-pack wizard) ============

  describe('POST /api/packs/scaffold', () => {
    it('scaffolds a pack on disk under ctx.projectRoot/packs/<slug>/', async () => {
      const root = tmpProjectRoot();
      const c = ctx({ projectRoot: root });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      assert.ok(route, 'POST /api/packs/scaffold must exist');
      const res = await route?.handle(
        { headers: {}, params: {}, body: { slug: 'pack-admin-demo', sut_type: 'api' } },
        c,
      );
      assert.equal(
        res?.status,
        201,
        `expected 201, got ${res?.status}: ${JSON.stringify(res?.body)}`,
      );
      const body = res?.body as { pack_dir: string; files: string[] };
      assert.equal(body.pack_dir, join(root, 'packs', 'pack-admin-demo'));
      assert.ok(body.files.includes('pack.yaml'), 'files list must include pack.yaml');
      assert.ok(existsSync(join(root, 'packs', 'pack-admin-demo', 'pack.yaml')));
    });

    it('returns 400 when the server has no projectRoot configured', async () => {
      const c = ctx(); // no projectRoot
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      const res = await route?.handle(
        { headers: {}, params: {}, body: { slug: 'pack-x', sut_type: 'api' } },
        c,
      );
      assert.equal(res?.status, 400);
      const body = res?.body as { error: string };
      assert.match(body.error, /projectRoot/i);
    });

    it('returns 400 on missing or invalid slug', async () => {
      const root = tmpProjectRoot();
      const c = ctx({ projectRoot: root });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      // missing slug
      const a = await route?.handle({ headers: {}, params: {}, body: { sut_type: 'api' } }, c);
      assert.equal(a?.status, 400);
      // invalid slug
      const b = await route?.handle(
        { headers: {}, params: {}, body: { slug: 'Bad Name!', sut_type: 'api' } },
        c,
      );
      assert.equal(b?.status, 400);
      assert.match((b?.body as { error: string }).error, /slug/i);
    });

    it('returns 400 on unsupported sut_type', async () => {
      const root = tmpProjectRoot();
      const c = ctx({ projectRoot: root });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      const res = await route?.handle(
        { headers: {}, params: {}, body: { slug: 'pack-z', sut_type: 'not-real' } },
        c,
      );
      assert.equal(res?.status, 400);
      assert.match((res?.body as { error: string }).error, /sut/i);
    });

    it('returns 409 when the pack already exists and force is not set', async () => {
      const root = tmpProjectRoot();
      const c = ctx({ projectRoot: root });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      const first = await route?.handle(
        { headers: {}, params: {}, body: { slug: 'pack-dup', sut_type: 'api' } },
        c,
      );
      assert.equal(first?.status, 201);
      const second = await route?.handle(
        { headers: {}, params: {}, body: { slug: 'pack-dup', sut_type: 'api' } },
        c,
      );
      assert.equal(second?.status, 409);
    });

    it('overwrites with force=true', async () => {
      const root = tmpProjectRoot();
      const c = ctx({ projectRoot: root });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      await route?.handle(
        { headers: {}, params: {}, body: { slug: 'pack-ow', sut_type: 'api' } },
        c,
      );
      const res = await route?.handle(
        { headers: {}, params: {}, body: { slug: 'pack-ow', sut_type: 'api', force: true } },
        c,
      );
      assert.equal(res?.status, 201);
    });

    it('requires the packs:install permission', () => {
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      assert.equal(route?.requires, 'packs:install');
    });

    it('rejects non-boolean force with 400 (no truthy-string smuggling)', async () => {
      // Regression test for PR #26 iter 1 (Codex P1 + Copilot):
      // Without strict type validation, `{"force": "yes"}` would pass
      // through the endpoint and `runPackNew` would treat the truthy
      // string as enabled — silently overwriting an existing pack.
      const root = tmpProjectRoot();
      const c = ctx({ projectRoot: root });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      const res = await route?.handle(
        { headers: {}, params: {}, body: { slug: 'pack-x', sut_type: 'api', force: 'yes' } },
        c,
      );
      assert.equal(res?.status, 400);
      assert.match((res?.body as { error: string }).error, /force.*boolean/i);
    });

    it('rejects non-string description/author/license with 400', async () => {
      const root = tmpProjectRoot();
      const c = ctx({ projectRoot: root });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      for (const k of ['description', 'author', 'license']) {
        const res = await route?.handle(
          { headers: {}, params: {}, body: { slug: 'pack-x', sut_type: 'api', [k]: 123 } },
          c,
        );
        assert.equal(res?.status, 400, `${k}=number must be rejected`);
        assert.match((res?.body as { error: string }).error, new RegExp(`${k}.*string`, 'i'));
      }
    });

    it('treats empty/whitespace optional strings as undefined (no blank manifest fields)', async () => {
      // Regression test for PR #26 iter 3 (Copilot):
      // A request with `{"description": "   "}` used to forward the
      // whitespace string to runPackNew, which then baked a blank
      // `description:` line into the generated pack.yaml. Now the
      // endpoint trims and drops empty values, so runPackNew falls
      // back to its own sensible default ("Pack scaffolded by aqa
      // pack new"). The test asserts the request succeeds AND the
      // resulting pack.yaml is NOT empty for that field.
      const root = tmpProjectRoot();
      const c = ctx({ projectRoot: root });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      const res = await route?.handle(
        {
          headers: {},
          params: {},
          body: {
            slug: 'pack-blank',
            sut_type: 'api',
            description: '   ',
            author: '',
            license: '\t',
          },
        },
        c,
      );
      assert.equal(res?.status, 201);
      const manifest = readFileSync(join(root, 'packs', 'pack-blank', 'pack.yaml'), 'utf8');
      // The scaffolder's fallback description must be present rather
      // than a literal empty `description:` line.
      assert.match(
        manifest,
        /description:\s+Pack scaffolded by aqa pack new/i,
        'whitespace-only description must fall back to the kit default, not write a blank line',
      );
    });

    it('trims whitespace around slug + sut_type before forwarding', async () => {
      // Regression test for PR #26 iter 2 (Copilot):
      // The endpoint used to check `slug.trim() !== ''` for non-empty
      // but then forward the untrimmed value, so `"  pack-trim  "`
      // would pass the boundary check and then runPackNew would reject
      // it with the unrelated "must be lowercase alphanumeric…" error.
      // Now the trim happens before forwarding, so a whitespace-padded
      // valid slug succeeds end-to-end.
      const root = tmpProjectRoot();
      const c = ctx({ projectRoot: root });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      const res = await route?.handle(
        { headers: {}, params: {}, body: { slug: '  pack-trim  ', sut_type: '  api  ' } },
        c,
      );
      assert.equal(
        res?.status,
        201,
        `expected 201 after trim, got ${res?.status}: ${JSON.stringify(res?.body)}`,
      );
      const body = res?.body as { pack_dir: string };
      assert.match(body.pack_dir, /pack-trim$/);
    });

    it('returns the structured code field alongside error on failure', async () => {
      // Regression test for the brittle regex-on-error 409 mapping.
      // The endpoint now uses runPackNew's structured `code` to pick
      // the HTTP status; this test asserts the code also propagates
      // to the response body so clients can act on it programmatically.
      const root = tmpProjectRoot();
      const c = ctx({ projectRoot: root });
      const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/packs/scaffold');
      // First scaffold to set up the conflict.
      await route?.handle(
        { headers: {}, params: {}, body: { slug: 'pack-code', sut_type: 'api' } },
        c,
      );
      // Second scaffold (same slug, no force) → EEXIST.
      const dup = await route?.handle(
        { headers: {}, params: {}, body: { slug: 'pack-code', sut_type: 'api' } },
        c,
      );
      assert.equal(dup?.status, 409);
      assert.equal((dup?.body as { code: string }).code, 'EEXIST');
      // EINVAL path: bad slug.
      const bad = await route?.handle(
        { headers: {}, params: {}, body: { slug: 'Bad!', sut_type: 'api' } },
        c,
      );
      assert.equal(bad?.status, 400);
      assert.equal((bad?.body as { code: string }).code, 'EINVAL');
    });
  });
});
