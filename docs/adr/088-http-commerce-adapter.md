# ADR-088 — Provider-neutral HTTP commerce adapter

## Status

Accepted — 2026-09-17

## Decision

`@aqa/commerce` now provides `HttpCommerceAdapter`. It maps the typed commerce
contract to configurable HTTP endpoints, enforces an origin allowlist and
bounded response body, propagates tenant/customer context through an explicit
host callback, parses every returned snapshot with Zod, and sends checkout and
refund idempotency keys both in the request body and header.

## Rationale

The commerce journey contracts are useful only when they can observe a real
merchant boundary. A provider-neutral HTTP adapter lets a pilot connect a
custom storefront or backend without baking Shopify/Stripe assumptions into
the core. The typed snapshots keep provider response blobs from becoming
unvalidated evidence.

## Limits

The adapter does not implement authentication, retries, provider webhooks or
automatic compensation; those remain host/provider policy. It also does not
claim checkout success from a browser redirect: the journey must re-read order,
payment and inventory through the authoritative endpoints.
