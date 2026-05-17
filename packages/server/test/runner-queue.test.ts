import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RunnerQueue } from '../dist/runner-queue.js';

const JOB = { id: 'job-1', payload: {}, enqueued_at: '2026-05-17T10:00:00Z' };

describe('RunnerQueue', () => {
  it('enqueues queued jobs in FIFO order', () => {
    const q = new RunnerQueue();
    q.enqueue(JOB);
    q.enqueue({ ...JOB, id: 'job-2' });
    assert.equal(q.dequeue()?.id, 'job-1');
    assert.equal(q.dequeue()?.id, 'job-2');
  });

  it('dequeue flips status to in_flight and stamps lease', () => {
    const q = new RunnerQueue();
    q.enqueue(JOB);
    const j = q.dequeue();
    assert.equal(j?.status, 'in_flight');
    assert.ok(j?.leased_until);
  });

  it('ack completes an in-flight job', () => {
    const q = new RunnerQueue();
    q.enqueue(JOB);
    const j = q.dequeue();
    assert.equal(q.ack(j?.id ?? ''), true);
    assert.equal(q.size(), 0);
  });

  it('stale leases are reclaimed on next dequeue', () => {
    const q = new RunnerQueue({ lease_ms: 100 });
    q.enqueue(JOB);
    q.dequeue(new Date('2026-05-17T10:00:00Z'));
    // simulate worker death: 200ms later, the lease is stale
    const next = q.dequeue(new Date('2026-05-17T10:00:00.500Z'));
    assert.equal(next?.id, 'job-1');
    assert.equal(next?.status, 'in_flight');
  });

  it('ack returns false for unknown / not-in-flight ids', () => {
    const q = new RunnerQueue();
    assert.equal(q.ack('missing'), false);
    q.enqueue(JOB);
    assert.equal(q.ack(JOB.id), false); // not in_flight yet
  });
});
