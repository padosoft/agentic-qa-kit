import type { ApiResponse } from './api.js';

export interface ApiIdempotencyOperation {
  scope: string;
  key: string;
  fingerprint: string;
}

export interface ApiIdempotencyStore {
  execute(
    operation: ApiIdempotencyOperation,
    handler: () => Promise<ApiResponse>,
  ): Promise<ApiResponse>;
}

/**
 * Process-local implementation for development and single-process installs.
 * Production deployments should inject a shared implementation backed by the
 * same durable store as the API, otherwise a restart or second replica can
 * legitimately execute a mutation again.
 */
export class MemoryApiIdempotencyStore implements ApiIdempotencyStore {
  private readonly completed = new Map<
    string,
    { fingerprint: string; response: ApiResponse; expiresAt: number }
  >();
  private readonly pending = new Map<
    string,
    { fingerprint: string; response: Promise<ApiResponse> }
  >();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { ttl_ms?: number; now?: () => number } = {}) {
    this.ttlMs = boundedPositive(
      options.ttl_ms ?? 7 * 24 * 60 * 60 * 1_000,
      31 * 24 * 60 * 60 * 1_000,
    );
    this.now = options.now ?? Date.now;
  }

  async execute(
    operation: ApiIdempotencyOperation,
    handler: () => Promise<ApiResponse>,
  ): Promise<ApiResponse> {
    const id = `${operation.scope}:${operation.key}`;
    const existing = this.completed.get(id);
    if (existing && existing.expiresAt > this.now()) {
      return existing.fingerprint === operation.fingerprint
        ? existing.response
        : conflictResponse();
    }
    if (existing) this.completed.delete(id);

    const active = this.pending.get(id);
    if (active) {
      return active.fingerprint === operation.fingerprint ? active.response : conflictResponse();
    }

    const response = handler();
    this.pending.set(id, { fingerprint: operation.fingerprint, response });
    try {
      const result = await response;
      // Do not cache server failures: a client may safely retry after a
      // transient failure, while deterministic 4xx/2xx results remain stable.
      if (result.status < 500) {
        this.completed.set(id, {
          fingerprint: operation.fingerprint,
          response: result,
          expiresAt: this.now() + this.ttlMs,
        });
      }
      return result;
    } finally {
      this.pending.delete(id);
    }
  }
}

export function validateIdempotencyKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const key = raw.trim();
  if (key.length < 1 || key.length > 200)
    throw new Error('Idempotency-Key must be 1..200 characters');
  return key;
}

function conflictResponse(): ApiResponse {
  return {
    status: 409,
    body: {
      error: 'idempotency key was reused with a different request',
      code: 'IDEMPOTENCY_CONFLICT',
    },
  };
}

function boundedPositive(value: number, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`ttl_ms must be an integer between 1 and ${max}`);
  return value;
}
