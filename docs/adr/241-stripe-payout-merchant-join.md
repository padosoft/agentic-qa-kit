# ADR-241 — Explicit Stripe payout-to-merchant source join

## Decision

Extend payout reconciliation with the optional
`expected_balance_transaction_sources` contract. When a merchant has
persisted provider source IDs for the orders/payments it expects in a payout,
the gateway reads `balance_transactions?payout=<id>` and requires every
expected source to be present in one complete, bounded page. Duplicate expected
sources, missing sources and `has_more=true` fail closed.

## Boundary

This proves inclusion of merchant-persisted provider source IDs in the Stripe
payout constituent ledger. It does not manufacture an order join from amount
equality, prove bank arrival, or reconcile tax/fee allocation unless the
merchant supplies those exact provider IDs and expectations. No raw provider
payload or secret is returned in evidence.
