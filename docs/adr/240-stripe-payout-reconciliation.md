# ADR-240 — Provider-backed Stripe payout reconciliation

## Decision

Add a bounded payout read-back boundary. `reconcileStripePayout()` retrieves a
Stripe payout and then independently reads its declared balance transaction.
It requires the transaction to be a `payout`, requires its `source` to equal
the exact payout ID, preserves signed balance amounts, and verifies payout
amount, fee, net equation, currency and optional lifecycle status against the
merchant-authoritative expectation.

## Boundary

This proves the provider payout and its balance transaction are internally
consistent. It does not prove bank arrival, payout timing, fee allocation to a
specific order, or a durable merchant payment/order-to-payout join. Those need
separate provider and deployment evidence. No secret key or raw provider
payload is returned in evidence.
