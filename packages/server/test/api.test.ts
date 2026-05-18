import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
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

function tmpProjectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'aqa-server-pack-'));
}

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
  });
});
