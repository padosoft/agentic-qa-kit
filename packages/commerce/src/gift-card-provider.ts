import { z } from 'zod';
import type { GiftCardBalance, GiftCardLedger, JourneyOutcome } from './index.js';

const ProviderMoney = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be an ISO-4217 code'),
  amount_minor: z.string().regex(/^(0|[1-9]\d*)$/, 'amount_minor must be a non-negative integer'),
});

/** Provider observation for the stored-value card under test. */
export const GiftCardProviderSnapshot = z.object({
  schema_version: z.literal('1'),
  provider: z.string().min(1),
  tenant: z.string().min(1),
  gift_card_id: z.string().min(1),
  status: z.enum(['active', 'expired', 'blocked']),
  balance: ProviderMoney,
  expires_at: z.string().datetime({ offset: true }).optional(),
  observed_at: z.string().datetime({ offset: true }),
});
export type GiftCardProviderSnapshot = z.infer<typeof GiftCardProviderSnapshot>;

export interface GiftCardProviderAdapter {
  observeGiftCard(tenant: string, giftCardId: string): Promise<GiftCardProviderSnapshot>;
}

export type GiftCardProviderReconciliationOptions = {
  tenant: string;
  gift_card_id: string;
  expected_status?: GiftCardProviderSnapshot['status'];
  now?: Date;
};

export type GiftCardProviderEvidence = {
  step: string;
  ok: boolean;
  detail: string;
};

export type GiftCardProviderReconciliationResult = {
  outcome: JourneyOutcome;
  evidence: readonly GiftCardProviderEvidence[];
  local_balance?: GiftCardBalance;
  provider?: GiftCardProviderSnapshot;
};

/**
 * Reconciles a provider's card identity, balance and expiry state with the
 * durable merchant ledger. Provider execution remains the adapter's concern;
 * this function only accepts and validates an authoritative observation.
 */
export async function verifyGiftCardProviderJourney(
  ledger: GiftCardLedger,
  provider: GiftCardProviderAdapter,
  options: GiftCardProviderReconciliationOptions,
): Promise<GiftCardProviderReconciliationResult> {
  const evidence: GiftCardProviderEvidence[] = [];
  try {
    const local = await ledger.balance(options.tenant, options.gift_card_id);
    if (!local) throw new Error('gift-card ledger has no balance for the requested card');
    const observed = GiftCardProviderSnapshot.parse(
      await provider.observeGiftCard(options.tenant, options.gift_card_id),
    );
    assertGiftCardProviderReconciliation(local, observed, options);
    evidence.push({
      step: 'gift-card.provider-reconciled',
      ok: true,
      detail: `provider=${observed.provider}; status=${observed.status}; balance=${observed.balance.amount_minor}`,
    });
    return {
      outcome: {
        status: 'pass',
        evidence_complete: true,
        reason: 'gift-card provider observation reconciled',
      },
      evidence,
      local_balance: local,
      provider: observed,
    };
  } catch (error) {
    return {
      outcome: {
        status: 'error',
        evidence_complete: evidence.length > 0,
        reason: error instanceof Error ? error.message : String(error),
      },
      evidence,
    };
  }
}

export function assertGiftCardProviderReconciliation(
  local: GiftCardBalance,
  observed: GiftCardProviderSnapshot,
  options: GiftCardProviderReconciliationOptions,
): void {
  if (local.tenant !== options.tenant || local.gift_card_id !== options.gift_card_id)
    throw new Error('local gift-card balance does not match requested identity');
  if (observed.tenant !== options.tenant || observed.gift_card_id !== options.gift_card_id)
    throw new Error('provider gift-card observation does not match requested identity');
  if (local.balance.currency !== observed.balance.currency)
    throw new Error('gift-card provider currency does not match ledger currency');
  if (local.balance.amount_minor !== observed.balance.amount_minor)
    throw new Error('gift-card provider balance does not reconcile with ledger balance');
  if (options.expected_status && observed.status !== options.expected_status)
    throw new Error(
      `gift-card provider status is ${observed.status}, expected ${options.expected_status}`,
    );

  const now = options.now ?? new Date();
  const expiresAt = observed.expires_at ? Date.parse(observed.expires_at) : undefined;
  if (expiresAt !== undefined && !Number.isFinite(expiresAt))
    throw new Error('gift-card provider expiry timestamp is invalid');
  if (observed.status === 'expired') {
    if (expiresAt === undefined) throw new Error('expired gift-card observation lacks expires_at');
    if (expiresAt > now.getTime())
      throw new Error('gift-card is marked expired before its expiry time');
  }
  if (observed.status === 'active' && expiresAt !== undefined && expiresAt <= now.getTime())
    throw new Error('gift-card is marked active after its expiry time');
  if (BigInt(observed.balance.amount_minor) < 0n)
    throw new Error('gift-card provider balance cannot be negative');
}
