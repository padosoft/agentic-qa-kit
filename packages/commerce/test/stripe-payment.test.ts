import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  StripePaymentGateway,
  reconcileStripeDisputes,
  reconcileStripePayout,
  reconcileStripeRefunds,
} from '../dist/index.js';

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

  it('reconciles the bounded Stripe dispute ledger and preserves evidence deadlines', async () => {
    const gateway = new StripePaymentGateway({
      secretKey: 'sk_test_abc123',
      fetch: async (input) =>
        jsonResponse(
          String(input).includes('/disputes?')
            ? {
                object: 'list',
                has_more: false,
                data: [
                  {
                    object: 'dispute',
                    id: 'dp_test_1',
                    payment_intent: 'pi_test_123',
                    amount: 300,
                    currency: 'eur',
                    status: 'needs_response',
                    evidence_details: { due_by: 1_736_726_400 },
                  },
                ],
              }
            : paymentIntent,
        ),
    });

    const result = await reconcileStripeDisputes(gateway, {
      payment_id: 'pi_test_123',
      expected_disputed: { currency: 'EUR', amount_minor: '300' },
    });

    assert.equal(result.disputes[0]?.dispute_id, 'dp_test_1');
    assert.equal(result.disputed_amount.amount_minor, '300');
    assert.equal(result.disputes[0]?.evidence_due_at, '2025-01-13T00:00:00.000Z');
  });

  it('fails closed on incomplete, mislinked or unknown Stripe disputes', async () => {
    const responseFor = (disputes: unknown) =>
      new StripePaymentGateway({
        secretKey: 'sk_test_abc123',
        fetch: async (input) =>
          jsonResponse(String(input).includes('/disputes?') ? disputes : paymentIntent),
      });

    await assert.rejects(
      reconcileStripeDisputes(responseFor({ object: 'list', has_more: true, data: [] }), {
        payment_id: 'pi_test_123',
        expected_disputed: { currency: 'EUR', amount_minor: '0' },
      }),
      /bounded dispute page/,
    );

    await assert.rejects(
      reconcileStripeDisputes(
        responseFor({
          object: 'list',
          has_more: false,
          data: [
            {
              object: 'dispute',
              id: 'dp_test_2',
              payment_intent: 'pi_other',
              amount: 300,
              currency: 'eur',
              status: 'lost',
            },
          ],
        }),
        {
          payment_id: 'pi_test_123',
          expected_disputed: { currency: 'EUR', amount_minor: '300' },
        },
      ),
      /different PaymentIntent/,
    );

    await assert.rejects(
      reconcileStripeDisputes(
        responseFor({
          object: 'list',
          has_more: false,
          data: [
            {
              object: 'dispute',
              id: 'dp_test_3',
              payment_intent: 'pi_test_123',
              amount: 300,
              currency: 'eur',
              status: 'future_provider_state',
            },
          ],
        }),
        {
          payment_id: 'pi_test_123',
          expected_disputed: { currency: 'EUR', amount_minor: '300' },
        },
      ),
      /unsupported dispute status/,
    );

    await assert.rejects(
      reconcileStripeDisputes(
        responseFor({
          object: 'list',
          has_more: false,
          data: [
            {
              object: 'dispute',
              id: 'dp_test_4',
              payment_intent: 'pi_test_123',
              amount: 301,
              currency: 'eur',
              status: 'lost',
            },
          ],
        }),
        {
          payment_id: 'pi_test_123',
          expected_disputed: { currency: 'EUR', amount_minor: '300' },
        },
      ),
      /dispute total does not reconcile/,
    );
  });

  it('reconciles a Stripe payout with its authoritative balance transaction', async () => {
    const gateway = new StripePaymentGateway({
      secretKey: 'sk_test_abc123',
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('/balance_transactions/'))
          return jsonResponse({
            object: 'balance_transaction',
            id: 'txn_payout_1',
            type: 'payout',
            source: 'po_test_1',
            amount: -1000,
            fee: 0,
            net: -1000,
            currency: 'eur',
          });
        if (url.includes('/balance_transactions?'))
          return jsonResponse({
            object: 'list',
            has_more: false,
            data: [
              {
                object: 'balance_transaction',
                id: 'txn_charge_1',
                type: 'charge',
                source: 'ch_test_1',
                amount: 1000,
                fee: 0,
                net: 1000,
                currency: 'eur',
              },
            ],
          });
        return jsonResponse({
          object: 'payout',
          id: 'po_test_1',
          amount: 1000,
          currency: 'eur',
          status: 'paid',
          balance_transaction: 'txn_payout_1',
        });
      },
    });

    const result = await reconcileStripePayout(gateway, {
      payout_id: 'po_test_1',
      expected_amount: { currency: 'EUR', amount_minor: '1000' },
      expected_fee: { currency: 'EUR', amount_minor: '0' },
      expected_status: 'paid',
      expected_balance_transaction_sources: ['ch_test_1'],
    });

    assert.equal(result.payout_id, 'po_test_1');
    assert.equal(result.balance_transaction_amount.amount_minor, '-1000');
    assert.equal(result.net_amount.amount_minor, '-1000');

    await assert.rejects(
      reconcileStripePayout(gateway, {
        payout_id: 'po_test_1',
        expected_amount: { currency: 'EUR', amount_minor: '1000' },
        expected_fee: { currency: 'EUR', amount_minor: '0' },
        expected_balance_transaction_sources: ['ch_test_1', 'ch_test_1'],
      }),
      /expected payout sources contain duplicates/,
    );
  });

  it('fails closed when the payout balance transaction is not its own payout entry', async () => {
    const gateway = new StripePaymentGateway({
      secretKey: 'sk_test_abc123',
      fetch: async (input) =>
        jsonResponse(
          String(input).includes('/balance_transactions/')
            ? {
                object: 'balance_transaction',
                id: 'txn_wrong',
                type: 'charge',
                source: 'ch_wrong',
                amount: -1000,
                fee: 0,
                net: -1000,
                currency: 'eur',
              }
            : String(input).includes('/balance_transactions?')
              ? { object: 'list', has_more: false, data: [] }
              : {
                  object: 'payout',
                  id: 'po_test_1',
                  amount: 1000,
                  currency: 'eur',
                  status: 'paid',
                  balance_transaction: 'txn_wrong',
                },
        ),
    });

    await assert.rejects(
      reconcileStripePayout(gateway, {
        payout_id: 'po_test_1',
        expected_amount: { currency: 'EUR', amount_minor: '1000' },
        expected_fee: { currency: 'EUR', amount_minor: '0' },
      }),
      /not a payout balance transaction/,
    );
  });

  it('fails closed when a merchant payment source is absent from the payout', async () => {
    const gateway = new StripePaymentGateway({
      secretKey: 'sk_test_abc123',
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('/balance_transactions/'))
          return jsonResponse({
            object: 'balance_transaction',
            id: 'txn_payout_1',
            type: 'payout',
            source: 'po_test_1',
            amount: -1000,
            fee: 0,
            net: -1000,
            currency: 'eur',
          });
        if (url.includes('/balance_transactions?'))
          return jsonResponse({
            object: 'list',
            has_more: false,
            data: [
              {
                object: 'balance_transaction',
                id: 'txn_other',
                type: 'charge',
                source: 'ch_other',
                amount: 1000,
                fee: 0,
                net: 1000,
                currency: 'eur',
              },
            ],
          });
        return jsonResponse({
          object: 'payout',
          id: 'po_test_1',
          amount: 1000,
          currency: 'eur',
          status: 'paid',
          balance_transaction: 'txn_payout_1',
        });
      },
    });

    await assert.rejects(
      reconcileStripePayout(gateway, {
        payout_id: 'po_test_1',
        expected_amount: { currency: 'EUR', amount_minor: '1000' },
        expected_fee: { currency: 'EUR', amount_minor: '0' },
        expected_balance_transaction_sources: ['ch_expected_for_order_1'],
      }),
      /expected balance transaction source is absent from payout/,
    );
  });

  it('fails closed when Stripe truncates the payout constituent ledger', async () => {
    const gateway = new StripePaymentGateway({
      secretKey: 'sk_test_abc123',
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('/balance_transactions/'))
          return jsonResponse({
            object: 'balance_transaction',
            id: 'txn_payout_1',
            type: 'payout',
            source: 'po_test_1',
            amount: -1000,
            fee: 0,
            net: -1000,
            currency: 'eur',
          });
        if (url.includes('/balance_transactions?'))
          return jsonResponse({ object: 'list', has_more: true, data: [] });
        return jsonResponse({
          object: 'payout',
          id: 'po_test_1',
          amount: 1000,
          currency: 'eur',
          status: 'paid',
          balance_transaction: 'txn_payout_1',
        });
      },
    });

    await assert.rejects(
      reconcileStripePayout(gateway, {
        payout_id: 'po_test_1',
        expected_amount: { currency: 'EUR', amount_minor: '1000' },
        expected_fee: { currency: 'EUR', amount_minor: '0' },
      }),
      /payout balance transaction list is incomplete/,
    );
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
