import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  InMemoryPromotionRedemptionLedger,
  PostgresPromotionRedemptionLedger,
} from '../dist/index.js';

describe('Promotion redemption ledger', () => {
  it('is idempotent, detects conflicts and enforces the cap', async () => {
    const ledger = new InMemoryPromotionRedemptionLedger();
    assert.equal(await ledger.claim('SAVE10', 'order-1', 2), 'claimed');
    assert.equal(await ledger.claim('SAVE10', 'order-1', 2), 'duplicate');
    assert.equal(await ledger.claim('OTHER', 'order-1', 2), 'conflict');
    assert.equal(await ledger.claim('SAVE10', 'order-2', 2), 'claimed');
    assert.equal(await ledger.claim('SAVE10', 'order-3', 2), 'exhausted');
  });

  it('shares the cap across PostgreSQL clients', async () => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      console.warn('SKIP: AQA_TEST_POSTGRES_DSN is required for the live PostgreSQL contract');
      return;
    }
    const first = new PostgresPromotionRedemptionLedger(dsn);
    const second = new PostgresPromotionRedemptionLedger(dsn);
    const code = `CI-${randomUUID()}`;
    try {
      const results = await Promise.all([
        first.claim(code, 'order-a', 1),
        second.claim(code, 'order-b', 1),
      ]);
      assert.equal(results.filter((result) => result === 'claimed').length, 1);
      assert.equal(results.filter((result) => result === 'exhausted').length, 1);
    } finally {
      await first.close();
      await second.close();
    }
  });
});
