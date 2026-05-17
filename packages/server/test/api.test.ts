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

describe('makeApi', () => {
  it('declares the v0.5 route surface', () => {
    const api = makeApi();
    const paths = api.map((r) => `${r.method} ${r.path}`);
    assert.deepEqual(paths.sort(), [
      'GET /api/findings',
      'GET /api/runner/jobs/next',
      'GET /api/runs',
      'POST /api/runs',
    ]);
  });

  it('GET /api/runs returns the stored runs', async () => {
    const c = ctx();
    const route = makeApi().find((r) => r.method === 'GET' && r.path === '/api/runs');
    const res = await route?.handle({ headers: {}, params: {} }, c);
    assert.equal(res?.status, 200);
    assert.deepEqual((res?.body as { runs: unknown[] }).runs, []);
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
});
