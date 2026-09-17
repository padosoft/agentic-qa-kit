import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export interface ScimTokenRecord {
  id: string;
  tenant: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at?: string;
}

export interface ScimTokenStore {
  get(id: string): Promise<ScimTokenRecord | null>;
  put(record: ScimTokenRecord): Promise<void>;
}

export interface ScimTokenAuditEvent {
  action: 'issued' | 'rotated' | 'revoked' | 'rejected';
  token_id: string;
  tenant: string;
  at: string;
  reason?: 'missing' | 'expired' | 'revoked' | 'tenant_mismatch' | 'invalid';
}

export type ScimTokenAudit = (event: ScimTokenAuditEvent) => Promise<void> | void;

export interface IssuedScimToken {
  id: string;
  tenant: string;
  token: string;
  expires_at: string;
}

/** Dedicated, opaque SCIM bearer-token lifecycle with hash-only persistence. */
export class ScimTokenManager {
  constructor(
    private readonly store: ScimTokenStore,
    private readonly audit?: ScimTokenAudit,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(tenant: string, ttlMs = 86_400_000): Promise<IssuedScimToken> {
    if (!tenant.trim()) throw new Error('[auth/scim-token] tenant is required');
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)
      throw new Error('[auth/scim-token] ttl must be positive');
    const at = this.now();
    const token = randomBytes(32).toString('base64url');
    const record: ScimTokenRecord = {
      id: `scim-token-${randomUUID()}`,
      tenant: tenant.trim(),
      token_hash: digest(token),
      created_at: at.toISOString(),
      expires_at: new Date(at.getTime() + ttlMs).toISOString(),
    };
    await this.store.put(record);
    await this.emit({
      action: 'issued',
      token_id: record.id,
      tenant: record.tenant,
      at: record.created_at,
    });
    return { id: record.id, tenant: record.tenant, token, expires_at: record.expires_at };
  }

  async verify(tenant: string, tokenId: string, token: string): Promise<boolean> {
    const at = this.now().toISOString();
    const record = await this.store.get(tokenId);
    if (!record) return this.reject(tokenId, tenant, at, 'missing');
    if (record.tenant !== tenant) return this.reject(record.id, tenant, at, 'tenant_mismatch');
    if (record.revoked_at) return this.reject(record.id, tenant, at, 'revoked');
    if (record.expires_at <= at) return this.reject(record.id, tenant, at, 'expired');
    const expected = Buffer.from(record.token_hash, 'hex');
    const actual = Buffer.from(digest(token), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return this.reject(record.id, tenant, at, 'invalid');
    return true;
  }

  async revoke(tenant: string, tokenId: string): Promise<boolean> {
    const record = await this.store.get(tokenId);
    if (!record || record.tenant !== tenant || record.revoked_at) return false;
    const at = this.now().toISOString();
    await this.store.put({ ...record, revoked_at: at });
    await this.emit({ action: 'revoked', token_id: record.id, tenant, at });
    return true;
  }

  async rotate(tenant: string, tokenId: string, ttlMs = 86_400_000): Promise<IssuedScimToken> {
    const revoked = await this.revoke(tenant, tokenId);
    if (!revoked) throw new Error('[auth/scim-token] token cannot be rotated');
    const next = await this.issue(tenant, ttlMs);
    await this.emit({ action: 'rotated', token_id: next.id, tenant, at: this.now().toISOString() });
    return next;
  }

  private async reject(
    tokenId: string,
    tenant: string,
    at: string,
    reason: NonNullable<ScimTokenAuditEvent['reason']>,
  ): Promise<false> {
    await this.emit({ action: 'rejected', token_id: tokenId, tenant, at, reason });
    return false;
  }

  private async emit(event: ScimTokenAuditEvent): Promise<void> {
    await this.audit?.(event);
  }
}

function digest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
