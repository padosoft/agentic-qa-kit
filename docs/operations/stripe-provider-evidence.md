# Stripe provider evidence

The manual `stripe-provider-evidence.yml` workflow verifies a read-only,
operator-owned Stripe test-mode boundary. It retrieves one pre-created
PaymentIntent through the real `StripePaymentGateway` and fails closed unless
the provider observation matches the configured currency, amount and status.

Configure the protected `commerce-provider-evidence` Environment with:

- `AQA_TEST_STRIPE_PAYMENT_ID` — a non-production test-mode PaymentIntent;
- `AQA_TEST_STRIPE_EXPECTED_CURRENCY`;
- `AQA_TEST_STRIPE_EXPECTED_AMOUNT_MINOR`;
- `AQA_TEST_STRIPE_EXPECTED_STATUS`;
- optional `AQA_TEST_STRIPE_EXPECTED_AMOUNT_RECEIVED_MINOR` and
  `AQA_TEST_STRIPE_API_VERSION`.

Store the matching `sk_test_…` value only as the secret
`AQA_TEST_STRIPE_SECRET_KEY`. The workflow rejects live-mode keys and the test
never prints the key, request headers or provider response body.

This is intentionally read-only. A successful run proves the configured
PaymentIntent retrieval and typed observation boundary; it does not prove
checkout creation, webhook delivery, refund settlement, payout reconciliation,
disputes, tax, shipping, fulfillment, availability or disaster recovery.
Those remain separate evidence journeys and must not be inferred from this
check.
