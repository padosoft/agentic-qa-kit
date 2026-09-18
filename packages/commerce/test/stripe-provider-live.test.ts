import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StripePaymentGateway } from '../dist/index.js';

const env = process.env;

describe('Stripe provider evidence', () => {
  const secretKey = env.AQA_TEST_STRIPE_SECRET_KEY;
  it(
    'retrieves and reconciles an operator-owned test-mode PaymentIntent',
    { skip: secretKey ? false : 'AQA_TEST_STRIPE_SECRET_KEY is not configured' },
    async () => {
      if (!secretKey) return;
      const paymentId = required('AQA_TEST_STRIPE_PAYMENT_ID');
      const expectedCurrency = required('AQA_TEST_STRIPE_EXPECTED_CURRENCY').toUpperCase();
      const expectedAmount = required('AQA_TEST_STRIPE_EXPECTED_AMOUNT_MINOR');
      const expectedStatus = required('AQA_TEST_STRIPE_EXPECTED_STATUS');
      const expectedAmountReceived = env.AQA_TEST_STRIPE_EXPECTED_AMOUNT_RECEIVED_MINOR;
      const gateway = new StripePaymentGateway({
        secretKey,
        apiVersion: env.AQA_TEST_STRIPE_API_VERSION,
      });

      const observation = await gateway.retrievePaymentIntent(paymentId);
      assert.equal(observation.provider, 'stripe');
      assert.equal(observation.payment_id, paymentId);
      assert.equal(observation.amount.currency, expectedCurrency);
      assert.equal(observation.amount.amount_minor, expectedAmount);
      assert.equal(observation.status, expectedStatus);
      if (expectedAmountReceived !== undefined) {
        assert.equal(observation.amount_received.currency, expectedCurrency);
        assert.equal(observation.amount_received.amount_minor, expectedAmountReceived);
      }
      assert.match(observation.observed_at, /^\d{4}-\d{2}-\d{2}T/);
    },
  );
});

function required(name: string): string {
  const value = env[name];
  if (!value?.trim()) throw new Error(`${name} is required when Stripe evidence is enabled`);
  return value.trim();
}
