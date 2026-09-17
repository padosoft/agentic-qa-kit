import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InMemoryCommerceReference,
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

  it('executes an isolated checkout exactly once and preserves minor-unit totals', () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'shoe-42',
      price: { currency: 'EUR', amount_minor: '1299' },
      on_hand: 1,
    });
    const identity = { tenant: 'shop-a', customer_id: 'customer-a' };
    const cart = merchant.createCart(identity);
    merchant.addLine(identity, cart.id, 'shoe-42', 1);

    const first = merchant.checkout(identity, cart.id, 'checkout-1');
    const retry = merchant.checkout(identity, cart.id, 'checkout-1');
    assert.deepEqual(retry, first);
    assert.equal(first.order.total.amount_minor, '1299');
    assert.equal(first.payment.status, 'captured');
    assert.equal(merchant.getInventory('shoe-42').committed, 1);
  });

  it('rejects a reused idempotency key with a different cart payload', () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'sku-a',
      price: { currency: 'EUR', amount_minor: '100' },
      on_hand: 2,
    });
    merchant.seedProduct({
      sku: 'sku-b',
      price: { currency: 'EUR', amount_minor: '200' },
      on_hand: 2,
    });
    const identity = { tenant: 'shop-a', customer_id: 'customer-a' };
    const cart = merchant.createCart(identity);
    merchant.addLine(identity, cart.id, 'sku-a', 1);
    merchant.checkout(identity, cart.id, 'same-key');
    const changedCart = merchant.createCart(identity);
    merchant.addLine(identity, changedCart.id, 'sku-b', 1);
    assert.throws(
      () => merchant.checkout(identity, changedCart.id, 'same-key'),
      /different payload|already checked out/,
    );
  });

  it('fails closed for the second customer competing for the last item', () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'last-one',
      price: { currency: 'EUR', amount_minor: '500' },
      on_hand: 1,
    });
    const a = { tenant: 'shop-a', customer_id: 'a' };
    const b = { tenant: 'shop-a', customer_id: 'b' };
    const cartA = merchant.createCart(a);
    const cartB = merchant.createCart(b);
    merchant.addLine(a, cartA.id, 'last-one', 1);
    merchant.addLine(b, cartB.id, 'last-one', 1);
    merchant.checkout(a, cartA.id, 'a-checkout');
    assert.throws(() => merchant.checkout(b, cartB.id, 'b-checkout'), /insufficient inventory/);
    assert.equal(merchant.getInventory('last-one').committed, 1);
  });

  it('denies cross-customer and cross-tenant order access', () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'sku-a',
      price: { currency: 'EUR', amount_minor: '100' },
      on_hand: 1,
    });
    const owner = { tenant: 'shop-a', customer_id: 'owner' };
    const cart = merchant.createCart(owner);
    merchant.addLine(owner, cart.id, 'sku-a', 1);
    const result = merchant.checkout(owner, cart.id, 'owner-checkout');
    assert.throws(
      () => merchant.getOrder({ tenant: 'shop-a', customer_id: 'other' }, result.order.id),
      /not found/,
    );
    assert.throws(
      () => merchant.getPayment({ tenant: 'shop-b', customer_id: 'owner' }, result.order.id),
      /not found/,
    );
  });

  it('caps refunds, and retries the same refund without a second effect', () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'sku-a',
      price: { currency: 'EUR', amount_minor: '1000' },
      on_hand: 1,
    });
    const identity = { tenant: 'shop-a', customer_id: 'owner' };
    const cart = merchant.createCart(identity);
    merchant.addLine(identity, cart.id, 'sku-a', 1);
    const order = merchant.checkout(identity, cart.id, 'checkout');
    const amount = { currency: 'EUR', amount_minor: '400' };
    const first = merchant.refund(identity, order.order.id, amount, 'refund-1');
    const retry = merchant.refund(identity, order.order.id, amount, 'refund-1');
    assert.deepEqual(retry, first);
    assert.equal(first.payment.refunded_amount.amount_minor, '400');
    assert.throws(
      () =>
        merchant.refund(
          identity,
          order.order.id,
          { currency: 'EUR', amount_minor: '601' },
          'refund-2',
        ),
      /exceeds captured/,
    );
  });
});
