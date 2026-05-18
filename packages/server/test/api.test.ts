import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryStore } from '@aqa/store';
import { RunnerQueue, makeApi } from '../dist/index.js';

const FAKE_USER = {
  id: '1',
  email: 'u@x.test',
  display_name: 'U',
  roles: ['admin' as const],
};

function ctx() {
  return {
    store: new MemoryStore(),
    queue: new RunnerQueue(),
    authenticate: async () => FAKE_USER,
  };
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

  it('GET /api/runs returns the stored runs', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/runs');
    const res = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(res?.status, 200);
    assert.deepEqual((res?.body as { runs: unknown[] }).runs, []);
  });

  it('GET /api/runs/:id 404s when missing', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/runs/:id');
    const res = await route?.handle({ headers: {}, params: { id: 'nope' } }, c);
    assert.equal(res?.status, 404);
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
});
