import postgres from 'postgres';
import type { Sql } from 'postgres';

export type WebhookClaim = 'claimed' | 'duplicate' | 'conflict';

export interface WebhookEffectLedger {
  claim(effectKey: string, eventId: string): Promise<WebhookClaim>;
}

/** Deterministic single-process ledger for contract tests and local development. */
export class InMemoryWebhookEffectLedger implements WebhookEffectLedger {
  private readonly claims = new Map<string, string>();

  async claim(effectKey: string, eventId: string): Promise<WebhookClaim> {
    if (!effectKey.trim() || !eventId.trim())
      throw new Error('[commerce/webhook] keys are required');
    const existing = this.claims.get(effectKey);
    if (!existing) {
      this.claims.set(effectKey, eventId);
      return 'claimed';
    }
    return existing === eventId ? 'duplicate' : 'conflict';
  }
}

/** Atomic shared effect ledger for multi-replica webhook consumers. */
export class PostgresWebhookEffectLedger implements WebhookEffectLedger {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string) {
    if (!dsn.trim()) throw new Error('[commerce/webhook] DSN is empty');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.ready = this.migrate();
  }

  async claim(effectKey: string, eventId: string): Promise<WebhookClaim> {
    if (!effectKey.trim() || !eventId.trim())
      throw new Error('[commerce/webhook] keys are required');
    await this.ready;
    const inserted = await this.query<{ inserted: boolean }>(
      'INSERT INTO aqa_webhook_effects (effect_key, event_id) VALUES ($1, $2) ON CONFLICT (effect_key) DO NOTHING RETURNING true AS inserted',
      [effectKey, eventId],
    );
    if (inserted[0]?.inserted === true) return 'claimed';
    const existing = await this.query<{ event_id: string }>(
      'SELECT event_id FROM aqa_webhook_effects WHERE effect_key = $1',
      [effectKey],
    );
    return existing[0]?.event_id === eventId ? 'duplicate' : 'conflict';
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
        'CREATE TABLE IF NOT EXISTS aqa_webhook_effects (effect_key text PRIMARY KEY, event_id text NOT NULL, claimed_at timestamptz NOT NULL DEFAULT now())',
      );
    });
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
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
  await effect();
  return 'applied';
}
