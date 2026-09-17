export interface RunnerJob {
  id: string;
  payload: Record<string, unknown>;
  enqueued_at: string;
  /** Stable caller key for exactly-once enqueue retries. */
  idempotency_key?: string;
  /** Canonical request fingerprint bound to the idempotency key. */
  idempotency_fingerprint?: string;
  /** Bounded scheduling hint. Higher values are dequeued first; default is 0. */
  priority?: number;
}

export interface RunnerScope {
  org: string;
  project?: string;
}

/** Result of runner authentication; scopes are enforced by the queue routes. */
export interface RunnerAuthorization {
  runner_id: string;
  scopes: readonly RunnerScope[];
}

export type RunnerAuthorizationResult = boolean | RunnerAuthorization;

export interface QueueQuota {
  concurrent_runs_max?: number;
  concurrent_scenarios_max?: number;
}

export interface EnqueuedJob extends RunnerJob {
  status: 'queued' | 'in_flight' | 'done' | 'failed' | 'cancelled';
  attempts: number;
  max_attempts: number;
  failure_reason?: string | undefined;
  leased_until?: string | undefined;
  lease_token?: string | undefined;
}

export interface QueueReapResult {
  requeued: number;
  failed: number;
}

export interface RunnerQueueLike {
  enqueue(job: RunnerJob): EnqueuedJob | Promise<EnqueuedJob>;
  dequeue(
    now?: Date,
    scopes?: readonly RunnerScope[],
  ): EnqueuedJob | null | Promise<EnqueuedJob | null>;
  get(id: string): EnqueuedJob | null | Promise<EnqueuedJob | null>;
  renew(id: string, leaseToken: string | undefined, now?: Date): boolean | Promise<boolean>;
  snapshot(): EnqueuedJob[] | Promise<EnqueuedJob[]>;
  ack(id: string, leaseToken?: string): boolean | Promise<boolean>;
  fail(id: string, leaseToken: string | undefined, reason: string): boolean | Promise<boolean>;
  /** Reclaim expired leases without requiring a worker dequeue. */
  reapExpired(now?: Date): QueueReapResult | Promise<QueueReapResult>;
  cancel(
    id: string,
    reason: string,
    scope?: { org: string; project: string },
  ): boolean | Promise<boolean>;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('[server/queue] idempotency key was reused with a different request');
    this.name = 'IdempotencyConflictError';
  }
}

export class ResourceQuotaExceededError extends Error {
  constructor(
    readonly quota: keyof QueueQuota,
    readonly limit: number,
    readonly current: number,
    readonly requested: number,
  ) {
    super(`[server/queue] resource quota exceeded: ${quota}`);
    this.name = 'ResourceQuotaExceededError';
  }
}

export function validateQueueQuota(quota: QueueQuota): QueueQuota {
  for (const [key, value] of Object.entries(quota)) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1))
      throw new Error(`[server/queue] ${key} must be a positive integer`);
  }
  return { ...quota };
}

export function validateJobPriority(priority: number | undefined): number {
  if (priority === undefined) return 0;
  if (!Number.isInteger(priority) || priority < -10 || priority > 10)
    throw new Error('[server/queue] priority must be an integer between -10 and 10');
  return priority;
}

export function assertQueueQuota(
  active: ReadonlyArray<Pick<EnqueuedJob, 'status' | 'payload'>>,
  job: RunnerJob,
  quota: QueueQuota,
): void {
  const scope = queueScope(job.payload);
  if (!scope) return;
  const scoped = active.filter(
    (candidate) =>
      (candidate.status === 'queued' || candidate.status === 'in_flight') &&
      queueScope(candidate.payload) === scope,
  );
  if (quota.concurrent_runs_max !== undefined && scoped.length >= quota.concurrent_runs_max)
    throw new ResourceQuotaExceededError(
      'concurrent_runs_max',
      quota.concurrent_runs_max,
      scoped.length,
      1,
    );
  const requestedScenarios = scenarioCount(job.payload);
  const activeScenarios = scoped.reduce(
    (sum, candidate) => sum + scenarioCount(candidate.payload),
    0,
  );
  if (
    quota.concurrent_scenarios_max !== undefined &&
    activeScenarios + requestedScenarios > quota.concurrent_scenarios_max
  )
    throw new ResourceQuotaExceededError(
      'concurrent_scenarios_max',
      quota.concurrent_scenarios_max,
      activeScenarios,
      requestedScenarios,
    );
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

  private readonly maxAttempts: number;
  private readonly idempotency = new Map<
    string,
    { fingerprint: string | undefined; jobId: string }
  >();

  private readonly quota: QueueQuota;

  constructor(opts: { lease_ms?: number; max_attempts?: number; quota?: QueueQuota } = {}) {
    this.leaseMs = opts.lease_ms ?? 30_000;
    this.maxAttempts = Math.max(1, opts.max_attempts ?? 5);
    this.quota = validateQueueQuota(opts.quota ?? {});
  }

  enqueue(job: RunnerJob): EnqueuedJob {
    const priority = validateJobPriority(job.priority);
    if (job.idempotency_key) {
      const previous = this.idempotency.get(job.idempotency_key);
      if (previous) {
        if (previous.fingerprint !== job.idempotency_fingerprint)
          throw new IdempotencyConflictError();
        const existing = this.jobs.find((candidate) => candidate.id === previous.jobId);
        if (existing) return { ...existing };
      }
    }
    assertQueueQuota(this.jobs, job, this.quota);
    const enq: EnqueuedJob = {
      ...job,
      ...(priority !== 0 ? { priority } : {}),
      status: 'queued',
      attempts: 0,
      max_attempts: this.maxAttempts,
    };
    this.jobs.push(enq);
    if (job.idempotency_key) {
      this.idempotency.set(job.idempotency_key, {
        fingerprint: job.idempotency_fingerprint,
        jobId: job.id,
      });
    }
    return enq;
  }

  dequeue(now: Date = new Date(), scopes?: readonly RunnerScope[]): EnqueuedJob | null {
    // Promote stale leases back to queued before picking the next.
    for (const j of this.jobs) {
      if (j.status === 'in_flight' && j.leased_until && new Date(j.leased_until) < now) {
        if (j.attempts >= j.max_attempts) {
          j.status = 'failed';
          j.failure_reason = 'lease expired after maximum attempts';
        } else {
          j.status = 'queued';
        }
        j.leased_until = undefined;
        j.lease_token = undefined;
      }
    }
    const job = this.jobs
      .filter((j) => j.status === 'queued' && matchesRunnerScopes(j.payload, scopes))
      .sort(
        (a, b) =>
          validateJobPriority(b.priority) - validateJobPriority(a.priority) ||
          a.enqueued_at.localeCompare(b.enqueued_at) ||
          a.id.localeCompare(b.id),
      )[0];
    if (!job) return null;
    job.status = 'in_flight';
    job.attempts += 1;
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

  get(id: string): EnqueuedJob | null {
    const job = this.jobs.find((candidate) => candidate.id === id);
    return job ? { ...job } : null;
  }

  renew(id: string, leaseToken: string | undefined, now = new Date()): boolean {
    if (!leaseToken) return false;
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (!job || job.status !== 'in_flight' || job.lease_token !== leaseToken) return false;
    job.leased_until = new Date(now.getTime() + this.leaseMs).toISOString();
    return true;
  }

  fail(id: string, leaseToken: string | undefined, reason: string): boolean {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status !== 'in_flight' || !leaseToken || job.lease_token !== leaseToken)
      return false;
    job.status = 'failed';
    job.failure_reason = reason.slice(0, 1000);
    job.leased_until = undefined;
    job.lease_token = undefined;
    return true;
  }

  reapExpired(now = new Date()): QueueReapResult {
    let requeued = 0;
    let failed = 0;
    for (const job of this.jobs) {
      if (job.status !== 'in_flight' || !job.leased_until || new Date(job.leased_until) >= now)
        continue;
      job.leased_until = undefined;
      job.lease_token = undefined;
      if (job.attempts >= job.max_attempts) {
        job.status = 'failed';
        job.failure_reason = 'lease expired after maximum attempts';
        failed += 1;
      } else {
        job.status = 'queued';
        requeued += 1;
      }
    }
    return { requeued, failed };
  }

  cancel(id: string, reason: string, scope?: { org: string; project: string }): boolean {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (!job || (job.status !== 'queued' && job.status !== 'in_flight')) return false;
    if (scope && queueScope(job.payload) !== `${scope.org}/${scope.project}`) return false;
    job.status = 'cancelled';
    job.failure_reason = reason.trim().slice(0, 1000) || 'cancelled by operator';
    job.leased_until = undefined;
    job.lease_token = undefined;
    return true;
  }

  size(): number {
    return this.jobs.filter((j) => j.status === 'queued' || j.status === 'in_flight').length;
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

export function queueScope(payload: Record<string, unknown>): string | undefined {
  return typeof payload.org === 'string' && typeof payload.project === 'string'
    ? `${payload.org}/${payload.project}`
    : undefined;
}

export function matchesRunnerScopes(
  payload: Record<string, unknown>,
  scopes?: readonly RunnerScope[],
): boolean {
  if (!scopes) return true;
  const org = typeof payload.org === 'string' ? payload.org : undefined;
  const project = typeof payload.project === 'string' ? payload.project : undefined;
  return scopes.some(
    (scope) => scope.org === org && (scope.project === undefined || scope.project === project),
  );
}

function scenarioCount(payload: Record<string, unknown>): number {
  return typeof payload.scenario_count === 'number' &&
    Number.isInteger(payload.scenario_count) &&
    payload.scenario_count > 0
    ? payload.scenario_count
    : 1;
}
import { randomUUID } from 'node:crypto';
