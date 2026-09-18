# ADR-262: Protected read-only Stripe provider evidence

## Decision

Add a manually triggered, protected GitHub Environment workflow that retrieves
an operator-owned Stripe test-mode PaymentIntent through the production
`StripePaymentGateway` and compares the typed observation with explicit
expected values.

## Rationale

The adapter and deterministic tests prove request construction and parsing, but
they cannot prove that Stripe accepts the configured credential or that the
provider response matches the merchant's expected payment. A read-only
PaymentIntent is the safest provider boundary to exercise without creating or
refunding money as part of CI.

## Safety boundary

The workflow requires an `sk_test_` secret, never logs it, and uses a protected
Environment. It is not evidence for settlement, payout, webhook delivery,
refund accounting, disputes or any other provider capability.
