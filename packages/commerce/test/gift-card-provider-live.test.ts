import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GiftCardProviderSnapshot,
  HttpGiftCardProvider,
  InMemoryGiftCardLedger,
  verifyGiftCardProviderJourney,
} from '../dist/index.js';

const endpoint = process.env.AQA_TEST_GIFT_CARD_PROVIDER_URL?.trim();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`required gift-card provider setting is missing: ${name}`);
  return value;
}

function positiveMoney(currency: string, amountMinor: string) {
  if (!/^[A-Z]{3}$/.test(currency) || !/^\d+$/.test(amountMinor))
    throw new Error('gift-card provider balance settings are invalid');
  return { currency, amount_minor: amountMinor };
}

/** Read-only issuer journey; it never creates or redeems a provider card. */
test(
  'live gift-card provider journey reconciles an issuer card with the merchant ledger',
  { skip: endpoint ? false : 'AQA_TEST_GIFT_CARD_PROVIDER_URL is not configured' },
  async () => {
    if (!endpoint) return;

    const tenant = required('AQA_TEST_GIFT_CARD_TENANT');
    const giftCardId = required('AQA_TEST_GIFT_CARD_ID');
    const currency = required('AQA_TEST_GIFT_CARD_BALANCE_CURRENCY');
    const amountMinor = required('AQA_TEST_GIFT_CARD_BALANCE_MINOR');
    const expectedStatus = required('AQA_TEST_GIFT_CARD_EXPECTED_STATUS');
    const nowValue = process.env.AQA_TEST_GIFT_CARD_NOW?.trim();
    const now = nowValue ? new Date(nowValue) : new Date();
    if (!Number.isFinite(now.getTime())) throw new Error('gift-card provider now is invalid');
    if (!['active', 'expired', 'blocked'].includes(expectedStatus))
      throw new Error('gift-card provider expected status is invalid');

    const amount = positiveMoney(currency, amountMinor);
    const ledger = new InMemoryGiftCardLedger();
    const numericAmount = BigInt(amountMinor);
    if (numericAmount > 0n) {
      assert.equal(
        await ledger.credit(tenant, giftCardId, 'live-provider-seed', amount),
        'credited',
      );
    } else {
      const one = { currency, amount_minor: '1' };
      assert.equal(
        await ledger.credit(tenant, giftCardId, 'live-provider-zero-seed', one),
        'credited',
      );
      assert.equal(
        await ledger.redeem(tenant, giftCardId, 'live-provider-zero-redeem', one),
        'redeemed',
      );
    }

    const authorization = process.env.AQA_TEST_GIFT_CARD_AUTHORIZATION;
    const provider = new HttpGiftCardProvider({
      baseUrl: endpoint,
      allowedOrigins: process.env.AQA_TEST_GIFT_CARD_ALLOWED_ORIGINS?.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      path: process.env.AQA_TEST_GIFT_CARD_PATH?.trim() || undefined,
      headers: () => (authorization ? { Authorization: authorization } : {}),
    });
    const result = await verifyGiftCardProviderJourney(ledger, provider, {
      tenant,
      gift_card_id: giftCardId,
      expected_status: GiftCardProviderSnapshot.shape.status.parse(expectedStatus),
      now,
    });

    assert.equal(result.outcome.status, 'pass', result.outcome.reason);
    assert.equal(result.outcome.evidence_complete, true);
    assert.equal(result.provider?.tenant, tenant);
    assert.equal(result.provider?.gift_card_id, giftCardId);
  },
);
