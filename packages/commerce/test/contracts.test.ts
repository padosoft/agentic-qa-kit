import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import {
  CommerceMutationGate,
  CommerceToolPolicy,
  HttpCommerceAdapter,
  InMemoryCommerceApprovalLedger,
  InMemoryCommerceReference,
  InMemoryWebhookEffectLedger,
  InventorySnapshot,
  JourneyOutcome,
  Money,
  PostgresWebhookEffectLedger,
  applyWebhookEffectOnce,
  assertCancellationIntegrity,
  assertChargebackIntegrity,
  assertFulfillmentIntegrity,
  assertLoyaltyLedgerIntegrity,
  assertNoOversell,
  assertOrderIntegrity,
  assertPaymentIntegrity,
  assertPromotionRedeemable,
  assertReturnRequestIntegrity,
  assertSameCurrency,
  assertSettlementIntegrity,
  assertSubscriptionIntegrity,
  assertTenderAllocation,
  verifyCheckoutJourney,
  verifyCommerceJourneySuite,
  verifyRefundJourney,
  verifyShippingJourney,
  verifyStripeWebhookSignature,
  verifyTaxJourney,
  verifyWebhookJourney,
} from '../dist/index.js';

describe('@aqa/commerce contracts', () => {
  it('allows only same-customer reads and requires a bound human approval for spending', () => {
    let now = new Date('2026-09-17T10:00:00Z');
    const policy = new CommerceToolPolicy({
      read_tools: ['catalog.search'],
      now: () => now,
    });
    const read = {
      schema_version: '1' as const,
      id: 'call-read',
      tenant: 'tenant-a',
      customer_id: 'customer-a',
      tool: 'catalog.search',
      operation: 'read' as const,
      target: { tenant: 'tenant-a', customer_id: 'customer-a' },
      requested_at: now.toISOString(),
    };
    assert.deepEqual(policy.authorize(read), { allowed: true, reason: 'read_allowed' });
    assert.equal(
      policy.authorize({
        ...read,
        id: 'cross',
        target: { tenant: 'tenant-b', customer_id: 'customer-a' },
      }).allowed,
      false,
    );
    const spend = {
      schema_version: '1' as const,
      id: 'call-buy',
      tenant: 'tenant-a',
      customer_id: 'customer-a',
      tool: 'checkout.submit',
      operation: 'financial' as const,
      target: { tenant: 'tenant-a', customer_id: 'customer-a' },
      cart_revision: 7,
      total: { currency: 'EUR', amount_minor: '1999' },
      requested_at: now.toISOString(),
    };
    assert.deepEqual(policy.authorize(spend), {
      allowed: false,
      reason: 'human_approval_required',
    });
    const approval = {
      schema_version: '1' as const,
      approval_id: 'approval-1',
      call_id: 'call-buy',
      tenant: 'tenant-a',
      customer_id: 'customer-a',
      cart_revision: 7,
      total: { currency: 'EUR', amount_minor: '1999' },
      approved_by: 'operator@example.test',
      source: 'human' as const,
      expires_at: '2026-09-17T10:05:00Z',
    };
    assert.deepEqual(policy.authorize(spend, approval), {
      allowed: true,
      reason: 'human_approval_allowed',
    });
    assert.deepEqual(policy.authorize(spend, approval), {
      allowed: false,
      reason: 'approval_already_consumed',
    });
    now = new Date('2026-09-17T10:06:00Z');
    assert.deepEqual(
      policy.authorize(
        { ...spend, id: 'call-buy-2' },
        { ...approval, approval_id: 'approval-2', call_id: 'call-buy-2' },
      ),
      { allowed: false, reason: 'approval_expired' },
    );
  });

  it('uses an atomic approval ledger for async multi-replica-style authorization', async () => {
    const ledger = new InMemoryCommerceApprovalLedger();
    const policy = new CommerceToolPolicy({
      read_tools: ['catalog.search'],
      approval_ledger: ledger,
      now: () => new Date('2026-09-17T10:00:00Z'),
    });
    const call = {
      schema_version: '1' as const,
      id: 'call-ledger',
      tenant: 'tenant-a',
      customer_id: 'customer-a',
      tool: 'checkout.submit',
      operation: 'financial' as const,
      target: { tenant: 'tenant-a', customer_id: 'customer-a' },
      cart_revision: 1,
      total: { currency: 'EUR', amount_minor: '1000' },
      requested_at: new Date('2026-09-17T10:00:00Z').toISOString(),
    };
    const approval = {
      schema_version: '1' as const,
      approval_id: 'approval-ledger',
      call_id: 'call-ledger',
      tenant: 'tenant-a',
      customer_id: 'customer-a',
      cart_revision: 1,
      total: { currency: 'EUR', amount_minor: '1000' },
      approved_by: 'operator@example.test',
      source: 'human' as const,
      expires_at: '2026-09-17T10:05:00Z',
    };
    assert.deepEqual(await policy.authorizeAsync(call, approval), {
      allowed: true,
      reason: 'human_approval_allowed',
    });
    assert.deepEqual(await policy.authorizeAsync(call, approval), {
      allowed: false,
      reason: 'approval_already_consumed',
    });
    assert.deepEqual(policy.authorize(call, approval), {
      allowed: false,
      reason: 'durable_approval_requires_async_authorize',
    });
  });

  it('never converts an ambiguous merchant mutation into a successful commit', async () => {
    const policy = new CommerceToolPolicy({
      read_tools: ['catalog.search'],
      now: () => new Date('2026-09-17T10:00:00Z'),
    });
    const gate = new CommerceMutationGate(policy);
    const call = {
      schema_version: '1' as const,
      id: 'call-gate',
      tenant: 'tenant-a',
      customer_id: 'customer-a',
      tool: 'checkout.submit',
      operation: 'financial' as const,
      target: { tenant: 'tenant-a', customer_id: 'customer-a' },
      cart_revision: 3,
      total: { currency: 'EUR', amount_minor: '2500' },
      requested_at: new Date('2026-09-17T10:00:00Z').toISOString(),
    };
    const approval = {
      schema_version: '1' as const,
      approval_id: 'approval-gate',
      call_id: 'call-gate',
      tenant: 'tenant-a',
      customer_id: 'customer-a',
      cart_revision: 3,
      total: { currency: 'EUR', amount_minor: '2500' },
      approved_by: 'operator@example.test',
      source: 'human' as const,
      expires_at: '2026-09-17T10:05:00Z',
    };
    assert.deepEqual(
      await gate.execute(call, approval, async () => ({ status: 'unknown', reason: 'timeout' })),
      {
        status: 'unknown',
        authorization: { allowed: true, reason: 'human_approval_allowed' },
        reason: 'timeout',
      },
    );
    assert.deepEqual(
      await gate.execute(call, approval, async () => ({ status: 'committed', value: 'order-1' })),
      {
        status: 'denied',
        authorization: { allowed: false, reason: 'approval_already_consumed' },
      },
    );
  });

  it('HttpCommerceAdapter performs bounded, tenant-scoped checkout calls', async () => {
    const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
    const cart = {
      schema_version: '1',
      id: 'cart-http',
      tenant: 'tenant-a',
      customer_id: 'customer-a',
      revision: 0,
      lines: [],
      status: 'open',
    };
    const adapter = new HttpCommerceAdapter({
      baseUrl: 'https://shop.test',
      headers: (_context, identity) => ({ 'X-Tenant': identity?.tenant ?? 'observer' }),
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        return new Response(JSON.stringify(cart), { status: 201 });
      },
    });
    const result = await adapter.createCart({ tenant: 'tenant-a', customer_id: 'customer-a' });
    assert.equal(result.id, 'cart-http');
    assert.equal(calls[0]?.headers.get('X-Tenant'), 'tenant-a');
    assert.equal(calls[0]?.url, 'https://shop.test/carts');
    assert.deepEqual(calls[0]?.body, undefined);
  });

  it('runs the complete checkout journey through a real local HTTP boundary', async () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'sku-http-journey',
      price: { currency: 'EUR', amount_minor: '1250' },
      on_hand: 3,
    });
    const service = merchant.asAdapter();
    const identity = { tenant: 'tenant-http', customer_id: 'customer-http' };
    const context = {
      schema_version: '1' as const,
      merchant: 'local-http-merchant',
      environment: 'sandbox' as const,
      tenant: identity.tenant,
      run_id: 'run-http-journey',
      policy_revision: 'test-policy-1',
      capabilities: {},
    };
    const server = createServer(async (req, res) => {
      try {
        const body = await new Promise<string>((resolve, reject) => {
          let value = '';
          req.setEncoding('utf8');
          req.on('data', (chunk) => {
            value += chunk;
          });
          req.on('end', () => resolve(value));
          req.on('error', reject);
        });
        const payload = body ? JSON.parse(body) : undefined;
        const url = new URL(req.url ?? '/', 'http://local.test');
        const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        let result: unknown;
        if (req.method === 'GET' && url.pathname === '/aqa/capabilities') {
          result = await service.capabilities(context);
        } else if (req.method === 'GET' && parts[0] === 'inventory') {
          result = await service.getInventory(parts[1] ?? '');
        } else if (req.method === 'POST' && parts[0] === 'carts' && parts.length === 1) {
          result = await service.createCart(identity);
        } else if (req.method === 'POST' && parts[0] === 'carts' && parts[2] === 'lines') {
          result = await service.addLine(identity, parts[1] ?? '', payload.sku, payload.quantity);
        } else if (req.method === 'POST' && parts[0] === 'carts' && parts[2] === 'checkout') {
          result = await service.checkout(identity, parts[1] ?? '', payload.idempotency_key);
        } else if (req.method === 'GET' && parts[0] === 'orders' && parts[2] === 'payment') {
          result = await service.getPayment(identity, parts[1] ?? '');
        } else if (req.method === 'GET' && parts[0] === 'orders') {
          result = await service.getOrder(identity, parts[1] ?? '');
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const adapter = new HttpCommerceAdapter({ baseUrl: `http://127.0.0.1:${port}` });
      const journey = await verifyCheckoutJourney(adapter, {
        context,
        identity,
        sku: 'sku-http-journey',
        quantity: 1,
        idempotencyKey: 'checkout-http-1',
      });
      assert.equal(journey.outcome.status, 'pass', journey.outcome.reason);
      assert.equal(journey.outcome.evidence_complete, true);
      assert.equal(journey.evidence.length, 4);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('applies a logical webhook effect once and rejects event-key conflicts', async () => {
    const ledger = new InMemoryWebhookEffectLedger();
    let effects = 0;
    assert.equal(
      await applyWebhookEffectOnce(ledger, 'order-1:payment_captured', 'evt-1', () => {
        effects += 1;
      }),
      'applied',
    );
    assert.equal(
      await applyWebhookEffectOnce(ledger, 'order-1:payment_captured', 'evt-1', () => {
        effects += 1;
      }),
      'duplicate',
    );
    await assert.rejects(
      () => applyWebhookEffectOnce(ledger, 'order-1:payment_captured', 'evt-2', () => undefined),
      /conflicts/,
    );
    assert.equal(effects, 1);
  });

  it('claims webhook effects atomically across PostgreSQL ledger instances', async () => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      console.warn('SKIP: AQA_TEST_POSTGRES_DSN is required for the live PostgreSQL contract');
      return;
    }
    const key = `commerce-effect-${Date.now()}`;
    const first = new PostgresWebhookEffectLedger(dsn);
    const second = new PostgresWebhookEffectLedger(dsn);
    assert.equal(await first.claim(key, 'evt-1'), 'claimed');
    assert.equal(await second.claim(key, 'evt-1'), 'duplicate');
    assert.equal(await second.claim(key, 'evt-2'), 'conflict');
    await first.close();
    await second.close();
  });

  it('verifies Stripe-style raw-body signatures and rejects replay windows', () => {
    const secret = 'whsec_test_only';
    const body = '{"id":"evt_test","type":"payment_intent.succeeded"}';
    const timestamp = 1_700_000_000;
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const header = `t=${timestamp},v1=${signature}`;
    assert.equal(
      verifyStripeWebhookSignature(body, header, secret, {
        now_ms: timestamp * 1_000,
      }).ok,
      true,
    );
    assert.equal(
      verifyStripeWebhookSignature(body, header, secret, {
        now_ms: (timestamp + 301) * 1_000,
      }).reason,
      'stale',
    );
    assert.equal(
      verifyStripeWebhookSignature(`${body} `, header, secret, {
        now_ms: timestamp * 1_000,
      }).reason,
      'invalid_signature',
    );
  });
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

  it('reconciles card, gift-card and store-credit tender exactly', () => {
    assertTenderAllocation({ currency: 'EUR', amount_minor: '1500' }, [
      { tender_id: 'card-1', kind: 'card', amount: { currency: 'EUR', amount_minor: '1000' } },
      { tender_id: 'gift-1', kind: 'gift_card', amount: { currency: 'EUR', amount_minor: '500' } },
    ]);
    assert.throws(
      () =>
        assertTenderAllocation({ currency: 'EUR', amount_minor: '1500' }, [
          { tender_id: 'card-1', kind: 'card', amount: { currency: 'EUR', amount_minor: '1499' } },
        ]),
      /does not reconcile/,
    );
    assert.throws(
      () =>
        assertTenderAllocation({ currency: 'EUR', amount_minor: '1500' }, [
          { tender_id: 'same', kind: 'card', amount: { currency: 'EUR', amount_minor: '500' } },
          {
            tender_id: 'same',
            kind: 'store_credit',
            amount: { currency: 'EUR', amount_minor: '1000' },
          },
        ]),
      /duplicate/,
    );
  });

  it('checks promotion expiry and redemption limit at commit time', () => {
    const valid = {
      code: 'ONEUSE',
      currency: 'EUR',
      discount: { currency: 'EUR', amount_minor: '100' },
      max_redemptions: 1,
      redemptions: 0,
    };
    assert.doesNotThrow(() => assertPromotionRedeemable(valid));
    assert.throws(() => assertPromotionRedeemable({ ...valid, redemptions: 1 }), /limit/);
    assert.throws(
      () => assertPromotionRedeemable({ ...valid, expires_at: '2020-01-01T00:00:00.000Z' }),
      /expired/,
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

  it('verifies tax and shipping quote journeys with provider-neutral evidence', async () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'sku-quote',
      price: { currency: 'EUR', amount_minor: '1299' },
      on_hand: 3,
    });
    const common = {
      context: {
        schema_version: '1' as const,
        merchant: 'reference',
        environment: 'sandbox' as const,
        tenant: 'shop-a',
        run_id: 'run-quotes',
        policy_revision: 'policy-1',
        capabilities: {},
      },
      identity: { tenant: 'shop-a', customer_id: 'customer-a' },
      sku: 'sku-quote',
      quantity: 1,
      idempotencyKey: 'quote-checkout',
    };
    const tax = await verifyTaxJourney(merchant.asAdapter(), common);
    assert.equal(tax.outcome.status, 'pass');
    assert.equal(tax.outcome.evidence_complete, true);
    const shipping = await verifyShippingJourney(merchant.asAdapter(), {
      ...common,
      destination: { country_code: 'IT', postal_code: '00100', city: 'Rome' },
    });
    assert.equal(shipping.outcome.status, 'pass');
    assert.match(shipping.evidence[0]?.detail ?? '', /rates=1/);
    const webhook = await verifyWebhookJourney(merchant.asAdapter(), common);
    assert.equal(webhook.outcome.status, 'pass');
    assert.equal(webhook.outcome.evidence_complete, true);
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
      on_hand: 3,
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

  it('rejects payment refund states that do not reconcile', () => {
    const payment = {
      schema_version: '1' as const,
      order_id: 'order-1',
      provider: 'reference',
      payment_id: 'payment-1',
      amount: { currency: 'EUR', amount_minor: '1000' },
      refunded_amount: { currency: 'EUR', amount_minor: '0' },
      status: 'partially_refunded' as const,
      observed_at: '2026-09-17T10:00:00Z',
    };
    assert.throws(
      () => assertPaymentIntegrity(payment),
      /partially refunded payment must have a positive partial amount/,
    );
    assert.throws(
      () =>
        assertPaymentIntegrity({
          ...payment,
          status: 'captured',
          refunded_amount: { currency: 'EUR', amount_minor: '100' },
        }),
      /payment refund status does not match refunded amount/,
    );
    assert.doesNotThrow(() =>
      assertPaymentIntegrity({
        ...payment,
        status: 'partially_refunded',
        refunded_amount: { currency: 'EUR', amount_minor: '100' },
      }),
    );
  });

  it('runs the provider-neutral checkout journey with complete evidence', async () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'journey-sku',
      price: { currency: 'EUR', amount_minor: '1299' },
      on_hand: 2,
    });
    const result = await verifyCheckoutJourney(merchant.asAdapter(), {
      context: {
        schema_version: '1',
        merchant: 'reference',
        environment: 'sandbox',
        tenant: 'shop-a',
        run_id: 'run-1',
        policy_revision: 'policy-1',
        capabilities: {},
      },
      identity: { tenant: 'shop-a', customer_id: 'journey-customer' },
      sku: 'journey-sku',
      quantity: 1,
      idempotencyKey: 'journey-checkout',
    });
    assert.equal(result.outcome.status, 'pass', result.outcome.reason);
    assert.equal(result.outcome.evidence_complete, true);
    assert.equal(result.evidence.length, 4);
  });

  it('aggregates checkout and refund into one fail-closed commerce gate', async () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'suite-sku',
      price: { currency: 'EUR', amount_minor: '1299' },
      on_hand: 3,
    });
    const context = {
      schema_version: '1' as const,
      merchant: 'reference',
      environment: 'sandbox' as const,
      tenant: 'shop-a',
      run_id: 'run-suite',
      policy_revision: 'policy-1',
      capabilities: {},
    };
    const result = await verifyCommerceJourneySuite(merchant.asAdapter(), {
      checkout: {
        context,
        identity: { tenant: 'shop-a', customer_id: 'suite-customer' },
        sku: 'suite-sku',
        quantity: 1,
        idempotencyKey: 'suite-checkout',
      },
      refund: {
        context,
        identity: { tenant: 'shop-a', customer_id: 'suite-refund-customer' },
        sku: 'suite-sku',
        quantity: 1,
        idempotencyKey: 'suite-refund-checkout',
        refundAmount: { currency: 'EUR', amount_minor: '400' },
        refundIdempotencyKey: 'suite-refund',
      },
      cancellation: {
        context,
        identity: { tenant: 'shop-a', customer_id: 'suite-cancel-customer' },
        sku: 'suite-sku',
        quantity: 1,
        idempotencyKey: 'suite-cancel-checkout',
        cancellationReason: 'customer requested cancellation',
        cancellationIdempotencyKey: 'suite-cancel',
      },
    });
    assert.equal(result.outcome.status, 'pass', result.outcome.reason);
    assert.equal(result.outcome.evidence_complete, true);
    assert.equal(Object.keys(result.journeys).length, 3);
    assert.ok(result.evidence.every((item) => item.step.includes('.')));
  });

  it('rejects a provider result whose line total is mathematically false', () => {
    assert.throws(
      () =>
        assertOrderIntegrity({
          schema_version: '1',
          id: 'order-1',
          revision: 1,
          tenant: 'shop-a',
          customer_id: 'customer-a',
          lines: [
            {
              sku: 'sku-a',
              quantity: 2,
              unit_price: { currency: 'EUR', amount_minor: '100' },
              line_total: { currency: 'EUR', amount_minor: '100' },
            },
          ],
          subtotal: { currency: 'EUR', amount_minor: '100' },
          tax: { currency: 'EUR', amount_minor: '0' },
          discount: { currency: 'EUR', amount_minor: '0' },
          total: { currency: 'EUR', amount_minor: '100' },
          currency: 'EUR',
          status: 'paid',
        }),
      /line total mismatch/,
    );
  });

  it('proves a partial refund is exactly-once under retry', async () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'refund-sku',
      price: { currency: 'EUR', amount_minor: '1000' },
      on_hand: 1,
    });
    const result = await verifyRefundJourney(merchant.asAdapter(), {
      context: {
        schema_version: '1',
        merchant: 'reference',
        environment: 'sandbox',
        tenant: 'shop-a',
        run_id: 'run-refund',
        policy_revision: 'policy-1',
        capabilities: {},
      },
      identity: { tenant: 'shop-a', customer_id: 'refund-customer' },
      sku: 'refund-sku',
      quantity: 1,
      idempotencyKey: 'refund-checkout',
      refundAmount: { currency: 'EUR', amount_minor: '400' },
      refundIdempotencyKey: 'refund-key',
    });
    assert.equal(result.outcome.status, 'pass');
    assert.equal(result.outcome.evidence_complete, true);
    assert.equal(result.evidence.length, 2);
  });

  it('enforces fulfillment and return quantities against the original order', () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'rma-sku',
      price: { currency: 'EUR', amount_minor: '1200' },
      on_hand: 2,
    });
    const identity = { tenant: 'shop-a', customer_id: 'rma-customer' };
    const cart = merchant.createCart(identity);
    merchant.addLine(identity, cart.id, 'rma-sku', 2);
    const { order } = merchant.checkout(identity, cart.id, 'rma-checkout');
    const delivered = {
      schema_version: '1' as const,
      id: 'fulfillment-1',
      order_id: order.id,
      lines: [{ sku: 'rma-sku', quantity: 1 }],
      status: 'delivered' as const,
      carrier: 'carrier',
      tracking_number: 'track-1',
      shipped_at: '2026-09-17T10:00:00Z',
      delivered_at: '2026-09-17T12:00:00Z',
    };
    assertFulfillmentIntegrity(order, delivered);
    assert.throws(
      () =>
        assertFulfillmentIntegrity(order, {
          ...delivered,
          lines: [{ sku: 'rma-sku', quantity: 3 }],
        }),
      /exceeds order quantity/,
    );
    assertReturnRequestIntegrity(order, {
      schema_version: '1',
      id: 'return-1',
      order_id: order.id,
      lines: [{ sku: 'rma-sku', quantity: 1 }],
      amount: { currency: 'EUR', amount_minor: '1200' },
      reason: 'damaged',
      status: 'requested',
      created_at: '2026-09-17T13:00:00Z',
    });
    assert.throws(
      () =>
        assertReturnRequestIntegrity(order, {
          schema_version: '1',
          id: 'return-2',
          order_id: order.id,
          lines: [{ sku: 'rma-sku', quantity: 1 }],
          amount: { currency: 'USD', amount_minor: '1200' },
          reason: 'wrong currency',
          status: 'requested',
          created_at: '2026-09-17T13:00:00Z',
        }),
      /currency/,
    );
  });

  it('enforces subscription periods and chargeback/payment linkage', () => {
    const subscription = {
      schema_version: '1' as const,
      id: 'sub-1',
      tenant: 'shop-a',
      customer_id: 'customer-a',
      plan: 'pro',
      status: 'active' as const,
      interval: 'month' as const,
      amount: { currency: 'EUR', amount_minor: '990' },
      current_period_start: '2026-09-01T00:00:00Z',
      current_period_end: '2026-10-01T00:00:00Z',
      cancel_at_period_end: false,
    };
    assertSubscriptionIntegrity(subscription);
    assert.throws(
      () =>
        assertSubscriptionIntegrity({
          ...subscription,
          current_period_end: '2026-08-01T00:00:00Z',
        }),
      /period end/,
    );
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'cb-sku',
      price: { currency: 'EUR', amount_minor: '1200' },
      on_hand: 1,
    });
    const identity = { tenant: 'shop-a', customer_id: 'customer-a' };
    const cart = merchant.createCart(identity);
    merchant.addLine(identity, cart.id, 'cb-sku', 1);
    const result = merchant.checkout(identity, cart.id, 'cb-key');
    assertChargebackIntegrity(result.order, result.payment, {
      schema_version: '1',
      id: 'cb-1',
      order_id: result.order.id,
      payment_id: result.payment.payment_id,
      amount: { currency: 'EUR', amount_minor: '1200' },
      status: 'opened',
      reason: 'fraud',
      opened_at: '2026-09-17T10:00:00Z',
      evidence_due_at: '2026-09-24T10:00:00Z',
    });
    assert.throws(
      () =>
        assertChargebackIntegrity(result.order, result.payment, {
          schema_version: '1',
          id: 'cb-2',
          order_id: result.order.id,
          payment_id: 'other-payment',
          amount: { currency: 'EUR', amount_minor: '1200' },
          status: 'lost',
          reason: 'fraud',
          opened_at: '2026-09-17T10:00:00Z',
        }),
      /exact order payment/,
    );
  });

  it('reconciles settlement totals across captures, refunds and lost chargebacks', () => {
    const payment = {
      schema_version: '1' as const,
      order_id: 'order-settlement',
      provider: 'reference',
      payment_id: 'payment-settlement',
      amount: { currency: 'EUR', amount_minor: '1000' },
      refunded_amount: { currency: 'EUR', amount_minor: '200' },
      status: 'partially_refunded' as const,
      observed_at: '2026-09-17T10:00:00Z',
    };
    const refund = {
      schema_version: '1' as const,
      id: 'refund-settlement',
      order_id: payment.order_id,
      amount: { currency: 'EUR', amount_minor: '200' },
      status: 'succeeded' as const,
      observed_at: '2026-09-17T10:01:00Z',
    };
    const chargeback = {
      schema_version: '1' as const,
      id: 'chargeback-settlement',
      order_id: payment.order_id,
      payment_id: payment.payment_id,
      amount: { currency: 'EUR', amount_minor: '100' },
      status: 'lost' as const,
      reason: 'fraud',
      opened_at: '2026-09-17T10:02:00Z',
    };
    assert.doesNotThrow(() =>
      assertSettlementIntegrity(payment, [refund], [chargeback], {
        schema_version: '1',
        provider: 'reference',
        order_id: payment.order_id,
        payment_id: payment.payment_id,
        captured: { currency: 'EUR', amount_minor: '1000' },
        refunded: { currency: 'EUR', amount_minor: '200' },
        chargeback: { currency: 'EUR', amount_minor: '100' },
        net: { currency: 'EUR', amount_minor: '700' },
        observed_at: '2026-09-17T10:03:00Z',
      }),
    );
    assert.throws(
      () =>
        assertSettlementIntegrity(payment, [refund], [chargeback], {
          schema_version: '1',
          provider: 'reference',
          order_id: payment.order_id,
          payment_id: payment.payment_id,
          captured: { currency: 'EUR', amount_minor: '1000' },
          refunded: { currency: 'EUR', amount_minor: '100' },
          chargeback: { currency: 'EUR', amount_minor: '100' },
          net: { currency: 'EUR', amount_minor: '800' },
          observed_at: '2026-09-17T10:03:00Z',
        }),
      /settlement totals do not reconcile/,
    );
  });

  it('reconciles loyalty balance from an idempotent transaction ledger', () => {
    const account = {
      schema_version: '1' as const,
      id: 'loyalty-1',
      tenant: 'shop-a',
      customer_id: 'customer-a',
      balance_points: 70,
      revision: 3,
    };
    const transactions = [
      {
        schema_version: '1' as const,
        id: 'lt-1',
        account_id: 'loyalty-1',
        kind: 'earn' as const,
        points: 100,
        reference: 'order-1',
        occurred_at: '2026-09-17T10:00:00Z',
      },
      {
        schema_version: '1' as const,
        id: 'lt-2',
        account_id: 'loyalty-1',
        kind: 'redeem' as const,
        points: -30,
        reference: 'order-2',
        occurred_at: '2026-09-17T11:00:00Z',
      },
    ];
    assertLoyaltyLedgerIntegrity(account, transactions);
    assert.throws(
      () =>
        assertLoyaltyLedgerIntegrity(account, [
          ...transactions,
          { ...transactions[0], id: 'lt-3', points: 10 },
        ]),
      /does not reconcile/,
    );
    assert.throws(
      () =>
        assertLoyaltyLedgerIntegrity(account, [
          { ...transactions[0], kind: 'redeem' as const, points: 10 },
        ]),
      /must reduce/,
    );
  });

  it('requires compensating refund evidence when cancelling a paid order', () => {
    const merchant = new InMemoryCommerceReference();
    merchant.seedProduct({
      sku: 'cancel-sku',
      price: { currency: 'EUR', amount_minor: '500' },
      on_hand: 1,
    });
    const identity = { tenant: 'shop-a', customer_id: 'customer-a' };
    const cart = merchant.createCart(identity);
    merchant.addLine(identity, cart.id, 'cancel-sku', 1);
    const result = merchant.checkout(identity, cart.id, 'cancel-key');
    const base = {
      schema_version: '1' as const,
      id: 'cancel-1',
      order_id: result.order.id,
      reason: 'customer request',
      requested_at: '2026-09-17T10:00:00Z',
      decided_at: '2026-09-17T10:01:00Z',
    };
    assert.throws(
      () =>
        assertCancellationIntegrity(result.order, result.payment, { ...base, status: 'accepted' }),
      /refund_id/,
    );
    assert.doesNotThrow(() =>
      assertCancellationIntegrity(result.order, result.payment, {
        ...base,
        status: 'accepted',
        refund_id: 'refund-1',
      }),
    );
  });
});
