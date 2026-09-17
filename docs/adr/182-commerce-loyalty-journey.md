# ADR-182: Verify checkout-linked loyalty ledger evidence

## Context

The commerce package already had loyalty snapshots and a ledger invariant, but
that only tested isolated data. It did not prove that a real checkout produced
an earn event for the same order, that the account belonged to the requested
tenant/customer, or that the observed balance reconciled to every transaction.

## Decision

Add the optional `loyalty_observer` capability and `observeLoyalty()` contract.
`verifyLoyaltyJourney()` performs a checkout, reads the authoritative loyalty
account and ledger, validates tenant ownership and ledger reconciliation, and
requires an earn transaction whose reference is the exact checkout order. An
optional expected-points assertion supports merchant-specific earning rules.
The aggregate suite can include this journey explicitly.

## Boundary

The HTTP adapter only parses provider-neutral snapshots; it does not assume a
specific loyalty vendor or points formula. The reference merchant uses a
deterministic minor-unit earn rule solely for contract tests. Provider-specific
earning, expiration, promotions, returns and durable atomicity still require a
live merchant integration and deployment evidence.
