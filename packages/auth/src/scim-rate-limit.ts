export interface ScimRateLimitOptions {
  max_requests?: number;
  window_ms?: number;
  max_tenants?: number;
  now?: () => number;
}

/** Bounded process-local limiter for a SCIM boundary; use a shared store in HA deployments. */
export class ScimRateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly maxTenants: number;
  private readonly now: () => number;

  constructor(options: ScimRateLimitOptions = {}) {
    this.maxRequests = options.max_requests ?? 120;
    this.windowMs = options.window_ms ?? 60_000;
    this.maxTenants = options.max_tenants ?? 10_000;
    this.now = options.now ?? Date.now;
    if (![this.maxRequests, this.windowMs, this.maxTenants].every(Number.isSafeInteger))
      throw new Error('[auth/scim-rate-limit] limits must be integers');
    if (this.maxRequests < 1 || this.windowMs < 1 || this.maxTenants < 1)
      throw new Error('[auth/scim-rate-limit] limits must be positive');
  }

  allow(tenant: string): boolean {
    const key = tenant.trim();
    if (!key) return false;
    const at = this.now();
    const recent = (this.windows.get(key) ?? []).filter(
      (timestamp) => at - timestamp < this.windowMs,
    );
    if (recent.length >= this.maxRequests) {
      this.windows.set(key, recent);
      return false;
    }
    recent.push(at);
    if (!this.windows.has(key) && this.windows.size >= this.maxTenants) {
      const oldest = this.windows.keys().next().value;
      if (oldest) this.windows.delete(oldest);
    }
    this.windows.set(key, recent);
    return true;
  }
}
