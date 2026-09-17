# ADR-020 — Provider-neutral commerce adapter journeys

## Status

Accepted — 2026-09-17

## Context

Commerce QA cannot establish correctness from an HTTP response or a
schema-valid order alone. The important properties are side effects: money
arithmetic, inventory transitions, payment/refund linkage, tenant/customer
authorization and idempotent retries. Provider integrations also differ in
transport and observability, so a reference merchant must not be mistaken for
evidence about Stripe, Adyen, Shopify, a tax engine or a warehouse system.

## Decision

`@aqa/commerce` exposes a provider-neutral asynchronous `CommerceAdapter`.
Adapters return validated snapshots and declare capabilities before a journey
starts. The first executable journeys are:

- checkout: capability preflight, cart/order/payment/inventory invariants,
  exact stock effect and idempotent retry;
- partial refund: captured-amount and currency bounds, order/payment linkage,
  and idempotent retry.

The journey result is explicitly `pass`, `unsupported` or `error` with
structured evidence. An unavailable observer is never treated as a clean
result. `InMemoryCommerceReference.asAdapter()` provides deterministic local
contract evidence only; production provider adapters remain separate work.

## Consequences

Real provider integrations can reuse the same safety assertions while keeping
their transport implementation private. A journey can prove business effects
instead of merely matching response shapes. Tax, shipping, promotion,
webhooks, fulfillment and durable reconciliation still require additional
capabilities and journeys; this ADR does not claim those features exist.

