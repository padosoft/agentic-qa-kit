import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StripePaymentGateway, reconcileStripeRefunds } from '../dist/index.js';

const paymentIntent = {
  object: 'payment_intent',
  id: 'pi_test_123',
  amount: 1099,
  amount_received: 1099,
  currency: 'eur',
  status: 'succeeded',
};

describe('StripePaymentGateway', () => {
  it('creates an idempotent PaymentIntent and maps the authoritative observation', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const gateway = new StripePaymentGateway({
      secretKey: 'sk_test_abc123',
      apiVersion: '2025-01-27.acacia',
      fetch: async (input, init) => {
        requests.push({ url: String(input), init: init ?? {} });
        return jsonResponse(paymentIntent);
      },
    });

    const result = await gateway.createPaymentIntent({
      amount: { currency: 'EUR', amount_minor: '1099' },
      order_id: 'order-1',
      customer_id: 'cus-1',
      idempotency_key: 'checkout-order-1',
    });

    assert.deepEqual(result, {
      provider: 'stripe',
      payment_id: 'pi_test_123',
      amount: { currency: 'EUR', amount_minor: '1099' },
      amount_received: { currency: 'EUR', amount_minor: '1099' },
      status: 'succeeded',
      observed_at: result.observed_at,
    });
    assert.equal(requests[0]?.url, 'https://api.stripe.com/v1/payment_intents');
    const headers = requests[0]?.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer sk_test_abc123');
    assert.equal(
      requests[0]?.init.headers &&
        (requests[0]?.init.headers as Record<string, string>)['Idempotency-Key'],
      'checkout-order-1',
    );
    assert.match(String(requests[0]?.init.body), /amount=1099/);
    assert.match(String(requests[0]?.init.body), /metadata%5Border_id%5D=order-1/);
  });

  it('retrieves a PaymentIntent and creates a bounded refund with a separate idempotency key', async () => {
    const urls: string[] = [];
    const gateway = new StripePaymentGateway({
      secretKey: 'sk_test_abc123',
      fetch: async (input) => {
        urls.push(String(input));
        return jsonResponse(
          urls.length === 1
            ? paymentIntent
            : {
                object: 'refund',
                id: 're_test_1',
                amount: 500,
                currency: 'eur',
                status: 'succeeded',
              },
        );
      },
    });
    const observed = await gateway.retrievePaymentIntent('pi_test_123');
    const refund = await gateway.createRefund({
      payment_id: observed.payment_id,
      amount: { currency: 'EUR', amount_minor: '500' },
      idempotency_key: 'refund-order-1',
    });
    assert.equal(observed.amount.amount_minor, '1099');
    assert.deepEqual(refund, {
      provider: 'stripe',
      refund_id: 're_test_1',
      payment_id: 'pi_test_123',
      amount: { currency: 'EUR', amount_minor: '500' },
      status: 'succeeded',
      observed_at: refund.observed_at,
    });
    assert.deepEqual(urls, [
      'https://api.stripe.com/v1/payment_intents/pi_test_123',
      'https://api.stripe.com/v1/refunds',
    ]);
  });

  it('fails closed on unsafe transport, amount and provider responses without leaking the key', async () => {
    assert.throws(
      () =>
        new StripePaymentGateway({ secretKey: 'sk_test_abc123', baseUrl: 'http://10.0.0.2/v1' }),
      /baseUrl must use HTTPS/,
    );
    const gateway = new StripePaymentGateway({
      secretKey: 'sk_test_abc123',
      fetch: async () =>
        jsonResponse({
          object: 'payment_intent',
          id: 'pi',
          amount: -1,
          currency: 'eur',
          status: 'succeeded',
        }),
    });
    await assert.rejects(
      gateway.createPaymentIntent({
        amount: { currency: 'EUR', amount_minor: '-1' },
        order_id: 'order-1',
        idempotency_key: 'key',
      }),
      /amount must contain/,
    );
    await assert.rejects(gateway.retrievePaymentIntent('pi'), /non-negative safe integer/);
    await assert.rejects(
      new StripePaymentGateway({
        secretKey: 'sk_test_abc123',
        fetch: async () => new Response('x'.repeat(20), { status: 200 }),
      }).retrievePaymentIntent('pi'),
      /invalid JSON/,
    );
  });

  it('reconciles the provider refund ledger against merchant totals', async () => {
    const urls: string[] = [];
    const gateway = new StripePaymentGateway({
      secretKey: 'sk_test_abc123',
      fetch: async (input) => {
        const url = String(input);
        urls.push(url);
        return jsonResponse(
          url.includes('/refunds?')
            ? {
                object: 'list',
                has_more: false,
                data: [
                  {
                    object: 'refund',
                    id: 're_1',
                    amount: 500,
                    currency: 'eur',
                    status: 'succeeded',
                  },
                ],
              }
            : paymentIntent,
        );
      },
    });
    const result = await reconcileStripeRefunds(gateway, {
      payment_id: 'pi_test_123',
      expected_captured: { currency: 'EUR', amount_minor: '1099' },
      expected_refunded: { currency: 'EUR', amount_minor: '500' },
    });
    assert.equal(result.refunded_amount.amount_minor, '500');
    assert.equal(result.refunds.length, 1);
    assert.match(urls[1] ?? '', /refunds\?payment_intent=pi_test_123&limit=100/);
  });

  it('fails closed on incomplete provider pagination and total drift', async () => {
    const paginated = new StripePaymentGateway({
      secretKey: 'sk_test_abc123',
      fetch: async (input) =>
        jsonResponse(
          String(input).includes('/refunds?')
            ? { object: 'list', has_more: true, data: [] }
            : paymentIntent,
        ),
    });
    await assert.rejects(
      reconcileStripeRefunds(paginated, {
        payment_id: 'pi_test_123',
        expected_captured: { currency: 'EUR', amount_minor: '1099' },
        expected_refunded: { currency: 'EUR', amount_minor: '0' },
      }),
      /bounded reconciliation page/,
    );

    const drifted = new StripePaymentGateway({
      secretKey: 'sk_test_abc123',
      fetch: async (input) =>
        jsonResponse(
          String(input).includes('/refunds?')
            ? {
                object: 'list',
                has_more: false,
                data: [
                  {
                    object: 'refund',
                    id: 're_1',
                    amount: 600,
                    currency: 'eur',
                    status: 'succeeded',
                  },
                ],
              }
            : paymentIntent,
        ),
    });
    await assert.rejects(
      reconcileStripeRefunds(drifted, {
        payment_id: 'pi_test_123',
        expected_captured: { currency: 'EUR', amount_minor: '1099' },
        expected_refunded: { currency: 'EUR', amount_minor: '500' },
      }),
      /refund total does not reconcile/,
    );
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
