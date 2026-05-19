import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { MemoryStore } from '@aqa/store';
import { RunnerQueue, makeApi } from '../dist/index.js';

const FAKE_USER = {
  id: '1',
  email: 'u@x.test',
  display_name: 'U',
  roles: ['admin' as const],
};

function ctx(opts: { projectRoot?: string } = {}) {
  return {
    store: new MemoryStore(),
    queue: new RunnerQueue(),
    authenticate: async () => FAKE_USER,
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

describe('makeApi', () => {
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

  it('POST /api/runs enqueues a job', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'POST' && r.path === '/api/runs');
    const res = await route?.handle({ headers: {}, params: {}, body: { profile: 'smoke' } }, c);
    assert.equal(res?.status, 202);
    assert.equal(c.queue.size(), 1);
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

  it('GET /api/orgs returns empty list initially', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/orgs');
    const res = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(res?.status, 200);
    assert.deepEqual((res?.body as { orgs: unknown[] }).orgs, []);
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
      oracles: [{ id: 'oracle-1', kind: 'http_status' as const, with: {}, weight: 1 }],
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
      oracles: [{ id: 'oracle-1', kind: 'http_status' as const, with: {}, weight: 1 }],
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
      oracles: [{ id: 'oracle-1', kind: 'http_status' as const, with: {}, weight: 1 }],
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
      (c.store as unknown as { seedAgent: (a: typeof sampleAgent) => void }).seedAgent(sampleAgent);
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

    it('POST /api/agents/:id/install flips installed=true and stamps last_updated', async () => {
      const c = ctx();
      (c.store as unknown as { seedAgent: (a: typeof sampleAgent) => void }).seedAgent(sampleAgent);
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
      (c.store as unknown as { seedAgent: (a: typeof sampleAgent) => void }).seedAgent({
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
