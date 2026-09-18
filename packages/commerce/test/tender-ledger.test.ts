import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { InMemoryGiftCardLedger, PostgresGiftCardLedger } from '../dist/index.js';

const eur = (amount_minor: string) => ({ currency: 'EUR', amount_minor });

describe('Gift-card tender ledger', () => {
  it('keeps credit/redeem operations idempotent and rejects conflicts', async () => {
    const ledger = new InMemoryGiftCardLedger();
    assert.equal(await ledger.credit('shop-a', 'gift-1', 'issue-1', eur('1000')), 'credited');
    assert.equal(await ledger.credit('shop-a', 'gift-1', 'issue-1', eur('1000')), 'duplicate');
    assert.equal(await ledger.credit('shop-a', 'gift-1', 'issue-1', eur('900')), 'conflict');
    assert.equal(await ledger.redeem('shop-a', 'gift-1', 'redeem-1', eur('400')), 'redeemed');
    assert.equal(await ledger.redeem('shop-a', 'gift-1', 'redeem-1', eur('400')), 'duplicate');
    assert.equal(await ledger.redeem('shop-a', 'gift-1', 'redeem-1', eur('300')), 'conflict');
    assert.deepEqual(await ledger.balance('shop-a', 'gift-1'), {
      tenant: 'shop-a',
      gift_card_id: 'gift-1',
      balance: eur('600'),
    });
  });

  it('serializes concurrent redemptions and never overspends the balance', async () => {
    const ledger = new InMemoryGiftCardLedger();
    await ledger.credit('shop-a', 'gift-race', 'issue-race', eur('1000'));
    const results = await Promise.all([
      ledger.redeem('shop-a', 'gift-race', 'redeem-a', eur('700')),
      ledger.redeem('shop-a', 'gift-race', 'redeem-b', eur('700')),
    ]);
    assert.equal(results.filter((result) => result === 'redeemed').length, 1);
    assert.equal(results.filter((result) => result === 'insufficient_funds').length, 1);
    assert.deepEqual((await ledger.balance('shop-a', 'gift-race'))?.balance, eur('300'));
  });

  it('keeps tenants and currencies isolated', async () => {
    const ledger = new InMemoryGiftCardLedger();
    await ledger.credit('shop-a', 'shared-id', 'issue-a', eur('500'));
    await ledger.credit('shop-b', 'shared-id', 'issue-b', eur('900'));
    assert.equal(await ledger.redeem('shop-b', 'shared-id', 'redeem-b', eur('800')), 'redeemed');
    assert.deepEqual((await ledger.balance('shop-a', 'shared-id'))?.balance, eur('500'));
    assert.deepEqual((await ledger.balance('shop-b', 'shared-id'))?.balance, eur('100'));
    await assert.rejects(
      ledger.credit('shop-a', 'shared-id', 'issue-usd', { currency: 'USD', amount_minor: '1' }),
      /currency conflict/,
    );
  });

  it('scopes idempotency keys to the tenant and gift card', async () => {
    const ledger = new InMemoryGiftCardLedger();
    await ledger.credit('shop-a', 'gift-a', 'same-operation', eur('100'));
    await ledger.credit('shop-b', 'gift-b', 'same-operation', eur('200'));
    assert.deepEqual((await ledger.balance('shop-a', 'gift-a'))?.balance, eur('100'));
    assert.deepEqual((await ledger.balance('shop-b', 'gift-b'))?.balance, eur('200'));
  });

  it('shares an atomic balance across PostgreSQL clients', async () => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      console.warn('SKIP: AQA_TEST_POSTGRES_DSN is required for the live PostgreSQL contract');
      return;
    }
    const first = new PostgresGiftCardLedger(dsn);
    const second = new PostgresGiftCardLedger(dsn);
    const card = `CI-${randomUUID()}`;
    try {
      await first.credit('ci-shop', card, `${card}-issue`, eur('1000'));
      const results = await Promise.all([
        first.redeem('ci-shop', card, `${card}-a`, eur('700')),
        second.redeem('ci-shop', card, `${card}-b`, eur('700')),
      ]);
      assert.equal(results.filter((result) => result === 'redeemed').length, 1);
      assert.equal(results.filter((result) => result === 'insufficient_funds').length, 1);
      assert.deepEqual((await second.balance('ci-shop', card))?.balance, eur('300'));
    } finally {
      await first.close();
      await second.close();
    }
  });
});
