# ADR-177: Make paid-order cancellation a compensating journey

## Context

Cancellation is not a UI status change for a paid order. It must authorize the
customer, preserve an idempotency boundary, and link an accepted decision to a
successful compensating refund. A standalone cancellation snapshot can hide a
payment/order mismatch.

## Decision

Extend the provider-neutral commerce adapter with an optional cancellation
capability and add `verifyCancellationJourney()`. The verifier performs a
checkout, requests cancellation, retries the same request, validates order /
payment / cancellation / refund linkage, and returns `unsupported` when the
provider cannot expose the required boundary. The in-memory reference and HTTP
adapter contracts expose the same shape.

## Boundary

The reference merchant proves contract behavior only. Provider-specific void
versus refund policy, inventory release, fulfillment cancellation and durable
external idempotency still require live adapter journeys.
