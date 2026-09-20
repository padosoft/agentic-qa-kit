import type {
  EnqueuedJob,
  QueueReapResult,
  RunnerJob,
  RunnerQueueLike,
  RunnerScope,
} from './runner-queue.js';

export type RunnerTokenSource = () => string | Promise<string>;

/**
 * Queue boundary for a runner process that is intentionally separate from
 * the control plane. The token source is invoked for every request so a
 * projected secret/JWT file can rotate without restarting the worker.
 */
export class HttpRunnerQueue implements RunnerQueueLike {
  private readonly baseUrl: string;
  private readonly token: RunnerTokenSource;
  private readonly expectedRunnerId: string | undefined;

  constructor(baseUrl: string, token: RunnerTokenSource, expectedRunnerId?: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(normalized))
      throw new Error('[runner/http] server URL must use http or https');
    this.baseUrl = normalized;
    this.token = token;
    this.expectedRunnerId = expectedRunnerId?.trim() || undefined;
  }

  async dequeue(_now?: Date, _scopes?: readonly RunnerScope[]): Promise<EnqueuedJob | null> {
    const response = await this.request('/api/runner/jobs/next');
    if (response.status === 204) return null;
    if (response.status !== 200) throw await httpError(response, 'dequeue');
    const body = (await response.json()) as { job?: EnqueuedJob };
    if (!body.job) throw new Error('[runner/http] dequeue response omitted job');
    if (this.expectedRunnerId && body.job.leased_by !== this.expectedRunnerId)
      throw new Error('[runner/http] lease identity does not match configured runner_id');
    return body.job;
  }

  async get(id: string): Promise<EnqueuedJob | null> {
    const response = await this.request(`/api/runner/jobs/${encodeURIComponent(id)}`);
    if (response.status === 404) return null;
    if (response.status !== 200) throw await httpError(response, 'get');
    const body = (await response.json()) as { job?: EnqueuedJob };
    return body.job ?? null;
  }

  async renew(id: string, leaseToken: string | undefined): Promise<boolean> {
    if (!leaseToken) return false;
    const response = await this.request(`/api/runner/jobs/${encodeURIComponent(id)}/renew`, {
      method: 'POST',
      body: JSON.stringify({ lease_token: leaseToken }),
    });
    if (response.status === 401 || response.status === 404) return false;
    if (response.status !== 200) throw await httpError(response, 'renew');
    return Boolean(((await response.json()) as { renewed?: unknown }).renewed);
  }

  async ack(id: string, leaseToken?: string): Promise<boolean> {
    if (!leaseToken) return false;
    const response = await this.request(`/api/runner/jobs/${encodeURIComponent(id)}/ack`, {
      method: 'POST',
      body: JSON.stringify({ lease_token: leaseToken }),
    });
    if (response.status === 401 || response.status === 404) return false;
    if (response.status !== 200 && response.status !== 409) throw await httpError(response, 'ack');
    return Boolean(((await response.json()) as { acknowledged?: unknown }).acknowledged);
  }

  async fail(id: string, leaseToken: string | undefined, reason: string): Promise<boolean> {
    if (!leaseToken) return false;
    const response = await this.request(`/api/runner/jobs/${encodeURIComponent(id)}/fail`, {
      method: 'POST',
      body: JSON.stringify({ lease_token: leaseToken, reason }),
    });
    if (response.status === 401 || response.status === 404) return false;
    if (response.status !== 200 && response.status !== 409) throw await httpError(response, 'fail');
    return Boolean(((await response.json()) as { failed?: unknown }).failed);
  }

  enqueue(_job: RunnerJob): Promise<EnqueuedJob> {
    return Promise.reject(new Error('[runner/http] enqueue is control-plane only'));
  }

  snapshot(): Promise<EnqueuedJob[]> {
    return Promise.reject(new Error('[runner/http] snapshot is control-plane only'));
  }

  reapExpired(_now?: Date): Promise<QueueReapResult> {
    return Promise.reject(new Error('[runner/http] reaping is control-plane only'));
  }

  cancel(
    _id: string,
    _reason: string,
    _scope?: { org: string; project: string },
  ): Promise<boolean> {
    return Promise.reject(new Error('[runner/http] cancel is control-plane only'));
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = (await this.token()).trim();
    if (!token) throw new Error('[runner/http] runner token is empty');
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    if (init.body) headers.set('content-type', 'application/json');
    return fetch(`${this.baseUrl}${path}`, { ...init, headers });
  }
}

async function httpError(response: Response, operation: string): Promise<Error> {
  const detail = (await response.text()).replace(/[\r\n\t]+/g, ' ').slice(0, 200);
  return new Error(
    `[runner/http] ${operation} failed (${response.status})${detail ? `: ${detail}` : ''}`,
  );
}
