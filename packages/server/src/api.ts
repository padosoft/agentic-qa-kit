import type { User } from '@aqa/auth';
import type { allows } from '@aqa/auth';
import type { Finding, Run } from '@aqa/schemas';
import type { StoreProvider } from '@aqa/store';
import type { RunnerQueue } from './runner-queue.js';

export interface ApiContext {
  store: StoreProvider;
  queue: RunnerQueue;
  /** Resolve the authenticated user from the request — wired to OIDC at v0.6. */
  authenticate: (headers: Record<string, string>) => Promise<User | null>;
}

export interface ApiHandler {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  requires: Parameters<typeof allows>[1] | null;
  handle: (
    req: { headers: Record<string, string>; body?: unknown; params: Record<string, string> },
    ctx: ApiContext,
  ) => Promise<{ status: number; body: unknown }>;
}

/**
 * Make the routing table for the AQA server. v0.5 ships the route shapes +
 * permission gates + store wiring; the Hono wrapper lands in v0.6 — the table
 * itself is HTTP-framework-agnostic so swapping is cheap.
 */
export function makeApi(): ApiHandler[] {
  return [
    {
      method: 'GET',
      path: '/api/runs',
      requires: 'runs:read',
      async handle(_req, ctx) {
        const runs = await ctx.store.listRuns({ limit: 100 });
        return { status: 200, body: { runs } as { runs: Run.Run[] } };
      },
    },
    {
      method: 'POST',
      path: '/api/runs',
      requires: 'runs:create',
      async handle(req, ctx) {
        const job = ctx.queue.enqueue({
          id: cryptoUuid(),
          payload: req.body as Record<string, unknown>,
          enqueued_at: new Date().toISOString(),
        });
        return { status: 202, body: { job } };
      },
    },
    {
      method: 'GET',
      path: '/api/findings',
      requires: 'findings:read',
      async handle(req, ctx) {
        const filter: { run_id?: string } = {};
        if (req.params.run_id) filter.run_id = req.params.run_id;
        const findings: Finding.Finding[] = await ctx.store.listFindings(filter);
        return { status: 200, body: { findings } };
      },
    },
    {
      method: 'GET',
      path: '/api/runner/jobs/next',
      requires: null,
      async handle(_req, ctx) {
        const next = ctx.queue.dequeue();
        return { status: next ? 200 : 204, body: next ? { job: next } : null };
      },
    },
  ];
}

function cryptoUuid(): string {
  // Avoid pulling node:crypto.randomUUID into the public type surface;
  // a stable RFC 4122 v4 hex is good enough for the queue id.
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}

function hex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i += 1) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
