# ADR-143: Commerce fulfillment and returns contracts

**Status:** Accepted  
**Date:** 2026-09-17

## Context

Checkout and refund coverage is insufficient for an ecommerce release. A
merchant can charge correctly while overshipping, accepting an RMA for more
units than ordered, or reporting delivery without tracking evidence.

## Decision

Add versioned `FulfillmentSnapshot` and `ReturnRequestSnapshot` contracts to
`@aqa/commerce`. Shared invariants verify tenant/order linkage at the adapter
boundary, reject duplicate SKU lines and quantities above the original order,
require carrier/tracking/shipped timestamps for shipped states, require a
delivery timestamp for delivered states, and enforce return amount currency and
positivity.

These are provider-neutral observations. They do not claim warehouse,
carrier, RMA approval or refund settlement integration; those adapters must
provide authoritative snapshots and preserve idempotency.
