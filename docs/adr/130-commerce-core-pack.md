# ADR-130: Opt-in commerce assurance pack

**Status:** Accepted  
**Date:** 2026-09-17

## Context

Generic API and web packs do not cover the failure modes that make an
ecommerce release unsafe: duplicate checkout/payment, finite-stock races,
money reconciliation, duplicate refunds and replayed webhooks. Activating
provider-shaped probes for every API project would create false failures and
would make the baseline pack non-deterministic across domains.

## Decision

Ship `pack-commerce-core` as an opt-in, provider-neutral pack selected only
when the project context contains an ecommerce tag (`ecommerce`, `commerce`,
`shop` or `storefront`). It declares risks/invariants and reusable HTTP/custom
scenarios for checkout idempotency, oversell prevention, tax/shipping currency
safety, refund idempotency and webhook replay protection.

The pack expresses required observations without pretending that a synthetic
reference merchant proves a real payment, tax, shipping or webhook provider.
Provider adapters must supply authoritative observations; unavailable evidence
is not a pass.

## Consequences

- Ecommerce projects receive domain-specific release-gate coverage without
  changing existing API or web projects.
- The pack is framework/provider independent and can be bound to HTTP, browser
  or commerce adapters as those become available.
- `${...}` fixtures and endpoint paths require project-specific configuration;
  the scenarios are contracts, not claims that every store exposes identical
  URLs.
