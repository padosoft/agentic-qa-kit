export interface RunnerJob {
  id: string;
  payload: Record<string, unknown>;
  enqueued_at: string;
}

export interface EnqueuedJob extends RunnerJob {
  status: 'queued' | 'in_flight' | 'done';
  leased_until?: string | undefined;
  lease_token?: string | undefined;
}

export interface RunnerQueueLike {
  enqueue(job: RunnerJob): EnqueuedJob | Promise<EnqueuedJob>;
  dequeue(now?: Date): EnqueuedJob | null | Promise<EnqueuedJob | null>;
  snapshot(): EnqueuedJob[] | Promise<EnqueuedJob[]>;
  ack(id: string, leaseToken?: string): boolean | Promise<boolean>;
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
        j.lease_token = undefined;
      }
    }
    const job = this.jobs.find((j) => j.status === 'queued');
    if (!job) return null;
    job.status = 'in_flight';
    job.leased_until = new Date(now.getTime() + this.leaseMs).toISOString();
    job.lease_token = randomUUID();
    // Never leak the mutable queue record: a later lease/requeue must not
    // rewrite the token held by an earlier worker.
    return { ...job };
  }

  ack(id: string, leaseToken?: string): boolean {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status !== 'in_flight' || !leaseToken || job.lease_token !== leaseToken)
      return false;
    job.status = 'done';
    job.lease_token = undefined;
    return true;
  }

  size(): number {
    return this.jobs.filter((j) => j.status !== 'done').length;
  }

  list(state?: EnqueuedJob['status']): ReadonlyArray<EnqueuedJob> {
    return state ? this.jobs.filter((j) => j.status === state) : [...this.jobs];
  }

  /** Snapshot for the admin `GET /api/queue` route. */
  snapshot(): EnqueuedJob[] {
    return [...this.jobs];
  }

  /** Mark a stuck in-flight job back to queued. Used by admin "requeue". */
  requeue(id: string): boolean {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return false;
    job.status = 'queued';
    job.leased_until = undefined;
    job.lease_token = undefined;
    return true;
  }

  /** Kill an in-flight job. Admin "force kill" — sets state to done so the
   * runner's eventual ack is a no-op. */
  kill(id: string): boolean {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return false;
    job.status = 'done';
    job.lease_token = undefined;
    return true;
  }
}
import { randomUUID } from 'node:crypto';
