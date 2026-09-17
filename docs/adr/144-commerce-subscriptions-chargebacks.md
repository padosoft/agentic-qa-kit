# ADR-144: Commerce subscriptions and chargeback contracts

**Status:** Accepted  
**Date:** 2026-09-17

## Context

Recurring billing and payment disputes have different lifecycles from a
one-time checkout. Treating them as a generic paid order hides inverted
subscription periods, cancellation ambiguity, mismatched dispute payments and
chargebacks larger than the captured amount.

## Decision

Add versioned `SubscriptionSnapshot` and `ChargebackSnapshot` contracts to
`@aqa/commerce`. Validate period ordering, non-negative recurring amount,
explicit cancellation-at-period-end semantics, exact order/payment linkage,
currency and amount bounds, and an evidence deadline for opened disputes.

These contracts are observations only. Billing provider proration, retries,
tax treatment, dunning, dispute evidence submission and settlement remain
provider adapter responsibilities.
