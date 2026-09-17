# ADR-178: Reconcile provider settlement as an executable journey

## Context

`assertSettlementIntegrity()` could validate a supplied snapshot, but no
adapter journey connected captured payment, refunds, chargebacks and net
settlement. A payment UI success or a refund API response alone is not
financial reconciliation evidence.

## Decision

Add an optional `settlement_observer` capability and
`verifySettlementJourney()`. The journey performs a checkout, reads the
authoritative settlement observation, verifies payment identity, parses all
refund/chargeback records and applies the reconciliation invariant. The
aggregate commerce suite can include it and preserves unsupported/error
outcomes.

## Boundary

The reference merchant proves arithmetic and linkage only. Acquirer
settlement, provider dispute feeds, payout timing, fees and live accounting
reconciliation remain production adapter evidence.
