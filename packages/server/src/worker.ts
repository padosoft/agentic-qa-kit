import type { EnqueuedJob, RunnerQueueLike, RunnerScope } from './runner-queue.js';
import { normalizeRunnerId } from './runner-queue.js';

export type RunnerJobHandler = (job: EnqueuedJob, signal: AbortSignal) => Promise<void>;

export interface RunnerWorkerOptions {
  /** Poll interval for both queue acquisition and cancellation observation. */
  poll_ms?: number;
  /** Optional callback for bounded worker diagnostics. */
  on_error?: (error: unknown, job: EnqueuedJob) => void;
  /** Tenant scopes assigned to this worker; undefined means legacy unscoped mode. */
  scopes?: readonly RunnerScope[];
  /** Stable runner identity used to fence lease mutation calls. */
  runner_id?: string;
}

export interface WorkerRunResult {
  status: 'idle' | 'completed' | 'failed' | 'cancelled' | 'lease_lost';
  job_id?: string;
}

/**
 * Cooperative queue worker. The queue remains the source of truth: a cancelled
 * job aborts the handler and fences the eventual ACK. This class intentionally
 * accepts a handler instead of hiding scenario loading/provider policy inside
 * the server package.
 */
export class RunnerWorker {
  private readonly pollMs: number;
  private stopped = false;

  constructor(
    private readonly queue: RunnerQueueLike,
    private readonly handle: RunnerJobHandler,
    opts: RunnerWorkerOptions = {},
  ) {
    this.pollMs = Math.max(10, opts.poll_ms ?? 250);
    this.onError = opts.on_error;
    this.scopes = opts.scopes;
    this.runnerId = normalizeRunnerId(opts.runner_id);
  }

  private readonly onError: RunnerWorkerOptions['on_error'];
  private readonly scopes: RunnerWorkerOptions['scopes'];
  private readonly runnerId: string | undefined;

  stop(): void {
    this.stopped = true;
  }

  async runOnce(): Promise<WorkerRunResult> {
    const job = await this.queue.dequeue(undefined, this.scopes, this.runnerId);
    if (!job) return { status: 'idle' };
    const controller = new AbortController();
    let cancelled = false;
    let leaseLost = false;
    let watcherActive = true;
    const refreshLease = async (): Promise<void> => {
      if (!watcherActive) return;
      try {
        const current = await this.queue.get(job.id);
        if (!watcherActive) return;
        if (current?.status === 'cancelled') {
          cancelled = true;
          controller.abort();
          return;
        }
        if (current?.status !== 'in_flight') {
          leaseLost = true;
          controller.abort();
          return;
        }
        const renewed = await this.queue.renew(job.id, job.lease_token, undefined, this.runnerId);
        if (!renewed) {
          leaseLost = true;
          controller.abort();
        }
      } catch {
        // A remote queue may be closed while a lease probe is in flight. The
        // worker must turn that into a fenced lease outcome, never an
        // unhandled rejection after runOnce() has already returned.
        if (watcherActive) {
          leaseLost = true;
          controller.abort();
        }
      }
    };
    const watcher = setInterval(() => {
      void refreshLease();
    }, this.pollMs);
    try {
      await this.handle(job, controller.signal);
      const current = await this.queue.get(job.id);
      if (cancelled || current?.status === 'cancelled')
        return { status: 'cancelled', job_id: job.id };
      if (leaseLost) return { status: 'lease_lost', job_id: job.id };
      const acknowledged = await this.queue.ack(job.id, job.lease_token, this.runnerId);
      return { status: acknowledged ? 'completed' : 'lease_lost', job_id: job.id };
    } catch (error) {
      const current = await this.queue.get(job.id);
      if (cancelled || current?.status === 'cancelled')
        return { status: 'cancelled', job_id: job.id };
      if (leaseLost) return { status: 'lease_lost', job_id: job.id };
      this.onError?.(error, job);
      await this.queue.fail(job.id, job.lease_token, boundedError(error), this.runnerId);
      return { status: 'failed', job_id: job.id };
    } finally {
      watcherActive = false;
      clearInterval(watcher);
    }
  }

  async runUntilStopped(): Promise<void> {
    while (!this.stopped) {
      const result = await this.runOnce();
      if (result.status === 'idle') await delay(this.pollMs);
    }
  }
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 1000) || 'worker handler failed';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
