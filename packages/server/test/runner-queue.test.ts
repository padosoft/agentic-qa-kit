import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  IdempotencyConflictError,
  ResourceQuotaExceededError,
  RunnerQueue,
} from '../dist/runner-queue.js';
import { RunnerWorker } from '../dist/worker.js';

const JOB = { id: 'job-1', payload: {}, enqueued_at: '2026-05-17T10:00:00Z' };

describe('RunnerQueue', () => {
  it('enqueues queued jobs in FIFO order', () => {
    const q = new RunnerQueue();
    q.enqueue(JOB);
    q.enqueue({ ...JOB, id: 'job-2' });
    assert.equal(q.dequeue()?.id, 'job-1');
    assert.equal(q.dequeue()?.id, 'job-2');
  });

  it('dequeues only jobs inside the runner scopes', () => {
    const q = new RunnerQueue();
    q.enqueue({
      id: 'org-a-job',
      payload: { org: 'org-a', project: 'shop' },
      enqueued_at: '2026-05-17T10:00:00Z',
    });
    q.enqueue({
      id: 'org-b-job',
      payload: { org: 'org-b', project: 'shop' },
      enqueued_at: '2026-05-17T10:01:00Z',
    });
    assert.equal(q.dequeue(undefined, [{ org: 'org-a', project: 'shop' }])?.id, 'org-a-job');
    assert.equal(q.dequeue(undefined, [{ org: 'org-a', project: 'shop' }]), null);
    assert.equal(q.dequeue(undefined, [{ org: 'org-b' }])?.id, 'org-b-job');
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
    assert.equal(q.ack(j?.id ?? '', j?.lease_token), true);
    assert.equal(q.size(), 0);
  });

  it('renews only the current lease token', () => {
    const q = new RunnerQueue({ lease_ms: 100 });
    q.enqueue(JOB);
    const lease = q.dequeue(new Date('2026-05-17T10:00:00Z'));
    assert.equal(q.renew(JOB.id, 'stale', new Date('2026-05-17T10:00:00.050Z')), false);
    assert.equal(q.renew(JOB.id, lease?.lease_token, new Date('2026-05-17T10:00:00.050Z')), true);
    assert.match(q.get(JOB.id)?.leased_until ?? '', /10:00:00\.150Z/);
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

  it('rejects a stale worker ACK after the lease is fenced and reassigned', () => {
    const q = new RunnerQueue({ lease_ms: 100 });
    q.enqueue(JOB);
    const first = q.dequeue(new Date('2026-05-17T10:00:00Z'));
    const second = q.dequeue(new Date('2026-05-17T10:00:00.200Z'));
    assert.ok(first?.lease_token);
    assert.ok(second?.lease_token);
    assert.notEqual(first?.lease_token, second?.lease_token);
    assert.equal(q.ack(JOB.id, first?.lease_token), false);
    assert.equal(q.ack(JOB.id, second?.lease_token), true);
  });

  it('moves a repeatedly expired lease to the dead-letter state', () => {
    const q = new RunnerQueue({ lease_ms: 100, max_attempts: 2 });
    q.enqueue(JOB);
    const first = q.dequeue(new Date('2026-05-17T10:00:00Z'));
    const second = q.dequeue(new Date('2026-05-17T10:00:00.200Z'));
    assert.equal(second?.attempts, 2);
    assert.equal(q.dequeue(new Date('2026-05-17T10:00:00.400Z')), null);
    const failed = q.snapshot().find((job) => job.id === JOB.id);
    assert.equal(failed?.status, 'failed');
    assert.match(failed?.failure_reason ?? '', /maximum attempts/i);
    assert.equal(q.fail(JOB.id, second?.lease_token, 'late failure'), false);
    assert.ok(first?.lease_token);
  });

  it('returns the same job for an idempotent retry and rejects a changed payload', () => {
    const q = new RunnerQueue();
    const first = q.enqueue({
      ...JOB,
      id: 'job-idempotent-1',
      idempotency_key: 'tenant/project:key',
      idempotency_fingerprint: 'fingerprint-a',
    });
    const retry = q.enqueue({
      ...JOB,
      id: 'job-idempotent-2',
      idempotency_key: 'tenant/project:key',
      idempotency_fingerprint: 'fingerprint-a',
    });
    assert.equal(retry.id, first.id);
    assert.equal(q.size(), 1);
    assert.throws(
      () =>
        q.enqueue({
          ...JOB,
          id: 'job-idempotent-3',
          idempotency_key: 'tenant/project:key',
          idempotency_fingerprint: 'fingerprint-b',
        }),
      IdempotencyConflictError,
    );
  });

  it('cancels queued or leased jobs as a terminal state and fences late ACKs', () => {
    const q = new RunnerQueue();
    const job = q.enqueue({
      ...JOB,
      id: 'cancel-1',
      payload: { org: 'acme', project: 'shop' },
    });
    const lease = q.dequeue();
    assert.equal(
      q.cancel(job.id, 'customer requested cancellation', { org: 'acme', project: 'shop' }),
      true,
    );
    assert.equal(q.ack(job.id, lease?.lease_token), false);
    assert.equal(q.snapshot().find((candidate) => candidate.id === job.id)?.status, 'cancelled');
    assert.equal(q.cancel(job.id, 'again', { org: 'acme', project: 'shop' }), false);
  });

  it('aborts an in-flight handler when the leased job is cancelled', async () => {
    const q = new RunnerQueue();
    const job = q.enqueue({ ...JOB, id: 'worker-cancel-1' });
    let aborted = false;
    const worker = new RunnerWorker(
      q,
      async (_job, signal) =>
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        }),
      { poll_ms: 10 },
    );
    const run = worker.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(q.cancel(job.id, 'operator stop'), true);
    assert.deepEqual(await run, { status: 'cancelled', job_id: job.id });
    assert.equal(aborted, true);
  });

  it('fails handler errors without exposing unbounded or multiline reasons', async () => {
    const q = new RunnerQueue();
    const job = q.enqueue({ ...JOB, id: 'worker-fail-1' });
    const worker = new RunnerWorker(q, async () => {
      throw new Error(`provider failed\n${'x'.repeat(2_000)}`);
    });
    assert.deepEqual(await worker.runOnce(), { status: 'failed', job_id: job.id });
    const stored = q.get(job.id);
    assert.equal(stored?.status, 'failed');
    assert.ok((stored?.failure_reason?.length ?? 0) <= 1_000);
    assert.equal(stored?.failure_reason?.includes('\n'), false);
  });

  it('does not ACK when fencing removes the lease during execution', async () => {
    const q = new RunnerQueue({ lease_ms: 100 });
    const job = q.enqueue({ ...JOB, id: 'worker-lease-lost-1' });
    const worker = new RunnerWorker(
      q,
      async (_job, signal) =>
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        ),
      { poll_ms: 10 },
    );
    const run = worker.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(q.requeue(job.id), true);
    assert.deepEqual(await run, { status: 'lease_lost', job_id: job.id });
  });

  it('enforces per-tenant concurrent run and scenario quotas', () => {
    const q = new RunnerQueue({ quota: { concurrent_runs_max: 1, concurrent_scenarios_max: 3 } });
    q.enqueue({ ...JOB, id: 'quota-1', payload: { org: 'o', project: 'p', scenario_count: 2 } });
    assert.throws(
      () =>
        q.enqueue({
          ...JOB,
          id: 'quota-2',
          payload: { org: 'o', project: 'p', scenario_count: 1 },
        }),
      (error: unknown) =>
        error instanceof ResourceQuotaExceededError && error.quota === 'concurrent_runs_max',
    );
    q.ack(q.dequeue()?.id ?? '', q.snapshot().find((job) => job.id === 'quota-1')?.lease_token);
    const scenarioQueue = new RunnerQueue({
      quota: { concurrent_runs_max: 5, concurrent_scenarios_max: 3 },
    });
    scenarioQueue.enqueue({
      ...JOB,
      id: 'quota-3',
      payload: { org: 'o', project: 'p', scenario_count: 3 },
    });
    assert.throws(
      () =>
        scenarioQueue.enqueue({
          ...JOB,
          id: 'quota-4',
          payload: { org: 'o', project: 'p', scenario_count: 1 },
        }),
      /scenario/i,
    );
  });
});
