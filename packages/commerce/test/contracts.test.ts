import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InventorySnapshot,
  JourneyOutcome,
  Money,
  assertNoOversell,
  assertSameCurrency,
} from '../dist/index.js';

describe('@aqa/commerce contracts', () => {
  it('rejects floating point or malformed currency money', () => {
    assert.equal(Money.safeParse({ currency: 'EUR', amount_minor: '1099' }).success, true);
    assert.equal(Money.safeParse({ currency: 'eur', amount_minor: '10.99' }).success, false);
  });

  it('rejects arithmetic across currencies', () => {
    assert.throws(
      () =>
        assertSameCurrency(
          { currency: 'EUR', amount_minor: '1' },
          { currency: 'USD', amount_minor: '1' },
        ),
      /cross-currency/,
    );
  });

  it('fails closed on oversell when backorder is disabled', () => {
    const snapshot = InventorySnapshot.parse({
      schema_version: '1',
      sku: 'sku-1',
      location: 'main',
      on_hand: 1,
      reserved: 1,
      committed: 1,
      revision: 1,
      backorder_allowed: false,
    });
    assert.throws(() => assertNoOversell(snapshot), /oversell/);
  });

  it('models unsupported evidence separately from pass/fail', () => {
    assert.equal(
      JourneyOutcome.parse({
        status: 'unsupported',
        evidence_complete: false,
        reason: 'provider observer unavailable',
      }).status,
      'unsupported',
    );
  });
});
