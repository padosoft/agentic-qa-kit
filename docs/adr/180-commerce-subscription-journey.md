# ADR-180: Verify subscription idempotency and durable observation

## Context

Subscription schemas and period invariants existed, but a commerce adapter
could not prove that creation was idempotent, tenant-scoped or still
observable after the write. A billing UI response is not durable subscription
evidence.

## Decision

Add an optional `subscription_observer` capability with typed create/get
adapter methods and `verifySubscriptionJourney()`. The journey checks plan,
amount, interval, period ordering, tenant/customer ownership, same-key retry
identity and a subsequent authoritative observation. The aggregate suite can
run it explicitly.

## Boundary

This is a provider-neutral subscription contract. Payment method lifecycle,
dunning/retry schedules, proration, invoices, tax, cancellation-at-period-end
and real billing provider behavior remain separate live integrations.
