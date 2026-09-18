import postgres from 'postgres';
import type { Sql } from 'postgres';

export type WebhookClaim = 'claimed' | 'duplicate' | 'conflict';

export type WebhookLedgerOptions = {
  lease_ms?: number;
};

function leaseMs(value: number | undefined): number {
  const result = value ?? 300_000;
  if (!Number.isSafeInteger(result) || result < 1)
    throw new Error('[commerce/webhook] lease_ms must be positive');
  return result;
}

export interface WebhookEffectLedger {
  claim(effectKey: string, eventId: string): Promise<WebhookClaim>;
  complete?(effectKey: string, eventId: string): Promise<void>;
  release?(effectKey: string, eventId: string): Promise<void>;
}

/** Deterministic single-process ledger for contract tests and local development. */
export class InMemoryWebhookEffectLedger implements WebhookEffectLedger {
  private readonly claims = new Map<
    string,
    { eventId: string; status: 'processing' | 'completed'; claimedAt: number }
  >();
  private readonly leaseMs: number;
  private readonly now: () => number;

  constructor(options: WebhookLedgerOptions & { now_ms?: () => number } = {}) {
    this.leaseMs = leaseMs(options.lease_ms);
    this.now = options.now_ms ?? Date.now;
  }

  async claim(effectKey: string, eventId: string): Promise<WebhookClaim> {
    if (!effectKey.trim() || !eventId.trim())
      throw new Error('[commerce/webhook] keys are required');
    const existing = this.claims.get(effectKey);
    if (!existing) {
      this.claims.set(effectKey, { eventId, status: 'processing', claimedAt: this.now() });
      return 'claimed';
    }
    if (
      existing.eventId === eventId &&
      existing.status === 'processing' &&
      this.now() - existing.claimedAt >= this.leaseMs
    ) {
      existing.claimedAt = this.now();
      return 'claimed';
    }
    return existing.eventId === eventId ? 'duplicate' : 'conflict';
  }

  async complete(effectKey: string, eventId: string): Promise<void> {
    const claim = this.claims.get(effectKey);
    if (claim?.eventId === eventId) claim.status = 'completed';
  }

  async release(effectKey: string, eventId: string): Promise<void> {
    const claim = this.claims.get(effectKey);
    if (claim?.eventId === eventId && claim.status === 'processing') this.claims.delete(effectKey);
  }
}

/** Atomic shared effect ledger for multi-replica webhook consumers. */
export class PostgresWebhookEffectLedger implements WebhookEffectLedger {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string, options: WebhookLedgerOptions = {}) {
    if (!dsn.trim()) throw new Error('[commerce/webhook] DSN is empty');
    this.leaseMs = leaseMs(options.lease_ms);
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.ready = this.migrate();
  }

  async claim(effectKey: string, eventId: string): Promise<WebhookClaim> {
    if (!effectKey.trim() || !eventId.trim())
      throw new Error('[commerce/webhook] keys are required');
    await this.ready;
    const inserted = await this.query<{ inserted: boolean }>(
      "INSERT INTO aqa_webhook_effects (effect_key, event_id, status) VALUES ($1, $2, 'processing') ON CONFLICT (effect_key) DO NOTHING RETURNING true AS inserted",
      [effectKey, eventId],
    );
    if (inserted[0]?.inserted === true) return 'claimed';
    const existing = await this.query<{ event_id: string; status: string; claimed_at: string }>(
      'SELECT event_id, status, claimed_at FROM aqa_webhook_effects WHERE effect_key = $1',
      [effectKey],
    );
    const row = existing[0];
    if (!row || row.event_id !== eventId) return 'conflict';
    if (row.status === 'completed') return 'duplicate';
    const reclaimed = await this.query<{ reclaimed: boolean }>(
      "UPDATE aqa_webhook_effects SET claimed_at = now() WHERE effect_key = $1 AND event_id = $2 AND status = 'processing' AND claimed_at < now() - ($3::double precision * interval '1 millisecond') RETURNING true AS reclaimed",
      [effectKey, eventId, this.leaseMs],
    );
    return reclaimed[0]?.reclaimed === true ? 'claimed' : 'duplicate';
  }

  async complete(effectKey: string, eventId: string): Promise<void> {
    await this.query(
      "UPDATE aqa_webhook_effects SET status = 'completed' WHERE effect_key = $1 AND event_id = $2 AND status = 'processing'",
      [effectKey, eventId],
    );
  }

  async release(effectKey: string, eventId: string): Promise<void> {
    await this.query(
      "DELETE FROM aqa_webhook_effects WHERE effect_key = $1 AND event_id = $2 AND status = 'processing'",
      [effectKey, eventId],
    );
  }

  private async query<T>(text: string, values: unknown[] = []): Promise<T[]> {
    await this.ready;
    const unsafe = this.sql.unsafe as unknown as (
      query: string,
      params: unknown[],
    ) => Promise<unknown>;
    return (await unsafe(text, values)) as T[];
  }

  private async migrate(): Promise<void> {
    await this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_webhook_effects_schema'))");
      await query(
        "CREATE TABLE IF NOT EXISTS aqa_webhook_effects (effect_key text PRIMARY KEY, event_id text NOT NULL, status text NOT NULL DEFAULT 'completed', claimed_at timestamptz NOT NULL DEFAULT now())",
      );
      await query(
        "ALTER TABLE aqa_webhook_effects ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'",
      );
      await query(
        "ALTER TABLE aqa_webhook_effects ADD CONSTRAINT aqa_webhook_effects_status_check CHECK (status IN ('processing', 'completed'))",
      ).catch(() => undefined);
    });
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  private readonly leaseMs: number;
}

/** Run a business effect only for the first delivery of a logical effect. */
export async function applyWebhookEffectOnce(
  ledger: WebhookEffectLedger,
  effectKey: string,
  eventId: string,
  effect: () => Promise<void> | void,
): Promise<'applied' | 'duplicate'> {
  const claim = await ledger.claim(effectKey, eventId);
  if (claim === 'duplicate') return 'duplicate';
  if (claim === 'conflict')
    throw new Error('[commerce/webhook] effect key conflicts with another event');
  try {
    await effect();
    await ledger.complete?.(effectKey, eventId);
    return 'applied';
  } catch (error) {
    await ledger.release?.(effectKey, eventId);
    throw error;
  }
}
