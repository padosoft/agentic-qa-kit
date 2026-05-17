import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReviewQueue } from '../dist/queue.js';

const SCN = {
  schema_version: '1' as const,
  id: 'scn-1',
  title: 'sample',
  risk_refs: ['r-1'],
  invariant_refs: [],
  preconditions: [],
  steps: [{ id: 'p1', kind: 'http' as const, with: {}, timeout_ms: 1000 }],
  oracles: [{ id: 'o1', kind: 'http_status' as const, with: { expected: 200 }, weight: 1 }],
  cleanup: [],
  tags: [],
};

describe('ReviewQueue', () => {
  it('enqueues in pending state', () => {
    const q = new ReviewQueue();
    const item = q.enqueue(SCN, 'item-1');
    assert.equal(item.state, 'pending');
    assert.equal(q.list('pending').length, 1);
  });

  it('approve moves pending → approved and records reviewer', () => {
    const q = new ReviewQueue();
    q.enqueue(SCN, 'item-1');
    const r = q.approve('item-1', 'alice');
    assert.equal(r?.state, 'approved');
    assert.equal(r?.reviewer, 'alice');
    assert.equal(q.approvedScenarios().length, 1);
  });

  it('reject moves pending → rejected and records rationale', () => {
    const q = new ReviewQueue();
    q.enqueue(SCN, 'item-1');
    const r = q.reject('item-1', 'bob', 'duplicate of scn-existing');
    assert.equal(r?.state, 'rejected');
    assert.equal(r?.rationale, 'duplicate of scn-existing');
    assert.equal(q.approvedScenarios().length, 0);
  });

  it('refuses to transition from a terminal state', () => {
    const q = new ReviewQueue();
    q.enqueue(SCN, 'item-1');
    q.approve('item-1', 'alice');
    assert.throws(() => q.reject('item-1', 'bob', 'x'), /cannot transition/);
  });

  it('returns null when transitioning a missing id', () => {
    const q = new ReviewQueue();
    assert.equal(q.approve('missing', 'alice'), null);
  });
});
