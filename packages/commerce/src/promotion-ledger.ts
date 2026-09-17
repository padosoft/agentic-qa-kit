import postgres from 'postgres';
import type { Sql } from 'postgres';

export type PromotionRedemptionClaim = 'claimed' | 'duplicate' | 'conflict' | 'exhausted';

/** Shared atomic redemption boundary for promotions with a hard usage cap. */
export interface PromotionRedemptionLedger {
  claim(
    promotionCode: string,
    redemptionId: string,
    maxRedemptions: number,
  ): Promise<PromotionRedemptionClaim>;
  close?(): Promise<void>;
}

export class InMemoryPromotionRedemptionLedger implements PromotionRedemptionLedger {
  private readonly claims = new Map<string, string>();
  private readonly counts = new Map<string, number>();

  async claim(
    promotionCode: string,
    redemptionId: string,
    maxRedemptions: number,
  ): Promise<PromotionRedemptionClaim> {
    validateClaim(promotionCode, redemptionId, maxRedemptions);
    const existing = this.claims.get(redemptionId);
    if (existing) return existing === promotionCode ? 'duplicate' : 'conflict';
    const count = this.counts.get(promotionCode) ?? 0;
    if (count >= maxRedemptions) return 'exhausted';
    this.claims.set(redemptionId, promotionCode);
    this.counts.set(promotionCode, count + 1);
    return 'claimed';
  }
}

export class PostgresPromotionRedemptionLedger implements PromotionRedemptionLedger {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string) {
    if (!dsn.trim()) throw new Error('[commerce/promotion] DSN is empty');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.ready = this.migrate();
  }

  async claim(
    promotionCode: string,
    redemptionId: string,
    maxRedemptions: number,
  ): Promise<PromotionRedemptionClaim> {
    validateClaim(promotionCode, redemptionId, maxRedemptions);
    await this.ready;
    return this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [promotionCode]);
      const prior = (await query(
        'SELECT promotion_code FROM aqa_commerce_promotion_redemptions WHERE redemption_id = $1',
        [redemptionId],
      )) as Array<{ promotion_code: string }>;
      if (prior[0]) return prior[0].promotion_code === promotionCode ? 'duplicate' : 'conflict';
      const count = (await query(
        'SELECT count(*)::int AS count FROM aqa_commerce_promotion_redemptions WHERE promotion_code = $1',
        [promotionCode],
      )) as Array<{ count: number }>;
      if ((count[0]?.count ?? 0) >= maxRedemptions) return 'exhausted';
      await query(
        'INSERT INTO aqa_commerce_promotion_redemptions (promotion_code, redemption_id) VALUES ($1, $2)',
        [promotionCode, redemptionId],
      );
      return 'claimed';
    });
  }

  private async migrate(): Promise<void> {
    await this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_commerce_promotion_schema'))");
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_commerce_promotion_redemptions (promotion_code text NOT NULL, redemption_id text PRIMARY KEY, claimed_at timestamptz NOT NULL DEFAULT now())',
      );
      await query(
        'CREATE INDEX IF NOT EXISTS aqa_commerce_promotion_code_idx ON aqa_commerce_promotion_redemptions (promotion_code)',
      );
    });
  }

  async close(): Promise<void> {
    await this.ready;
    await this.sql.end({ timeout: 5 });
  }
}

function validateClaim(code: string, redemptionId: string, maxRedemptions: number): void {
  if (!code.trim() || !redemptionId.trim())
    throw new Error('[commerce/promotion] code and redemption id are required');
  if (!Number.isSafeInteger(maxRedemptions) || maxRedemptions < 1)
    throw new Error('[commerce/promotion] max redemptions must be a positive safe integer');
}
