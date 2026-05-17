export interface RunnerJob {
  id: string;
  payload: Record<string, unknown>;
  enqueued_at: string;
}

export interface EnqueuedJob extends RunnerJob {
  status: 'queued' | 'in_flight' | 'done';
  leased_until?: string | undefined;
}

/**
 * In-memory FIFO queue with visibility-timeout leases. Runner workers poll
 * `GET /api/runner/jobs/next` which calls `dequeue()`; if the worker dies
 * without ack-ing, the lease expires and the job becomes visible again.
 *
 * The real implementation persists to the store (Postgres via Task 19's
 * follow-up). This scaffold is the in-memory contract every horizontal
 * server replica honors.
 */
export class RunnerQueue {
  private jobs: EnqueuedJob[] = [];
  private readonly leaseMs: number;

  constructor(opts: { lease_ms?: number } = {}) {
    this.leaseMs = opts.lease_ms ?? 30_000;
  }

  enqueue(job: RunnerJob): EnqueuedJob {
    const enq: EnqueuedJob = { ...job, status: 'queued' };
    this.jobs.push(enq);
    return enq;
  }

  dequeue(now: Date = new Date()): EnqueuedJob | null {
    // Promote stale leases back to queued before picking the next.
    for (const j of this.jobs) {
      if (j.status === 'in_flight' && j.leased_until && new Date(j.leased_until) < now) {
        j.status = 'queued';
        j.leased_until = undefined;
      }
    }
    const job = this.jobs.find((j) => j.status === 'queued');
    if (!job) return null;
    job.status = 'in_flight';
    job.leased_until = new Date(now.getTime() + this.leaseMs).toISOString();
    return job;
  }

  ack(id: string): boolean {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status !== 'in_flight') return false;
    job.status = 'done';
    return true;
  }

  size(): number {
    return this.jobs.filter((j) => j.status !== 'done').length;
  }

  list(state?: EnqueuedJob['status']): ReadonlyArray<EnqueuedJob> {
    return state ? this.jobs.filter((j) => j.status === state) : [...this.jobs];
  }
}
