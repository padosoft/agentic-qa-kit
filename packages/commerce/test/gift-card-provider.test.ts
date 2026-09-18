import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GiftCardProviderSnapshot,
  InMemoryGiftCardLedger,
  verifyGiftCardProviderJourney,
} from '../dist/index.js';

const eur = (amount_minor: string) => ({ currency: 'EUR', amount_minor });

async function seededLedger() {
  const ledger = new InMemoryGiftCardLedger();
  await ledger.credit('shop-a', 'gift-1', 'issue-1', eur('1000'));
  await ledger.redeem('shop-a', 'gift-1', 'redeem-1', eur('250'));
  return ledger;
}

function observation(overrides: Record<string, unknown> = {}) {
  return GiftCardProviderSnapshot.parse({
    schema_version: '1',
    provider: 'gift-provider-test',
    tenant: 'shop-a',
    gift_card_id: 'gift-1',
    status: 'active',
    balance: eur('750'),
    observed_at: '2026-09-18T12:00:00Z',
    ...overrides,
  });
}

describe('Gift-card provider reconciliation', () => {
  it('reconciles provider identity, currency and balance with the durable ledger', async () => {
    const ledger = await seededLedger();
    const result = await verifyGiftCardProviderJourney(
      ledger,
      { observeGiftCard: async () => observation() },
      { tenant: 'shop-a', gift_card_id: 'gift-1', now: new Date('2026-09-18T12:01:00Z') },
    );
    assert.equal(result.outcome.status, 'pass');
    assert.equal(result.outcome.evidence_complete, true);
  });

  it('fails closed when the provider returns another tenant or card', async () => {
    const ledger = await seededLedger();
    const result = await verifyGiftCardProviderJourney(
      ledger,
      { observeGiftCard: async () => observation({ tenant: 'shop-b', gift_card_id: 'gift-2' }) },
      { tenant: 'shop-a', gift_card_id: 'gift-1' },
    );
    assert.equal(result.outcome.status, 'error');
    assert.match(result.outcome.reason, /does not match requested identity/);
  });

  it('fails closed on provider balance drift instead of accepting a local-only pass', async () => {
    const ledger = await seededLedger();
    const result = await verifyGiftCardProviderJourney(
      ledger,
      { observeGiftCard: async () => observation({ balance: eur('749') }) },
      { tenant: 'shop-a', gift_card_id: 'gift-1' },
    );
    assert.equal(result.outcome.status, 'error');
    assert.match(result.outcome.reason, /balance does not reconcile/);
  });

  it('requires an expired observation to carry a timestamp that has elapsed', async () => {
    const ledger = await seededLedger();
    const futureExpired = await verifyGiftCardProviderJourney(
      ledger,
      {
        observeGiftCard: async () =>
          observation({ status: 'expired', expires_at: '2030-01-01T00:00:00Z' }),
      },
      { tenant: 'shop-a', gift_card_id: 'gift-1', now: new Date('2026-09-18T12:00:00Z') },
    );
    assert.equal(futureExpired.outcome.status, 'error');
    assert.match(futureExpired.outcome.reason, /before its expiry/);

    const validExpired = await verifyGiftCardProviderJourney(
      ledger,
      {
        observeGiftCard: async () =>
          observation({ status: 'expired', expires_at: '2020-01-01T00:00:00Z' }),
      },
      { tenant: 'shop-a', gift_card_id: 'gift-1', now: new Date('2026-09-18T12:00:00Z') },
    );
    assert.equal(validExpired.outcome.status, 'pass');
  });

  it('rejects an active card whose provider expiry has already elapsed', async () => {
    const ledger = await seededLedger();
    const result = await verifyGiftCardProviderJourney(
      ledger,
      { observeGiftCard: async () => observation({ expires_at: '2020-01-01T00:00:00Z' }) },
      { tenant: 'shop-a', gift_card_id: 'gift-1', now: new Date('2026-09-18T12:00:00Z') },
    );
    assert.equal(result.outcome.status, 'error');
    assert.match(result.outcome.reason, /marked active after its expiry/);
  });
});
