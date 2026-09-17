# ADR-119: ambiguous commerce mutation outcomes

## Status

Accepted

## Context

An agentic checkout or refund can receive a timeout after the merchant or
payment provider has committed the side effect. Treating the timeout as a
simple failure allows a retry that creates a second order, capture or refund;
treating it as success can report money or inventory that does not exist.

## Decision

Add `CommerceMutationGate` as the shared write orchestration boundary. It
authorizes the exact tool call asynchronously, invokes a provider-specific
executor, and exposes three terminal classifications:

- `committed`: the executor has authoritative evidence of the committed result;
- `not_committed`: the executor proves that no mutation was committed;
- `unknown`: transport or provider state is ambiguous and reconciliation is
  required before retry.

An exception from the executor is always classified as `unknown`. The approval
claim remains consumed; callers must not issue a blind retry. The executor is
responsible for atomically re-checking tenant/customer, cart revision, total,
idempotency key and provider mutation state in the merchant boundary.

## Consequences

The kit cannot manufacture atomicity for an external merchant, but it makes
ambiguity explicit and prevents a generic catch/retry path from becoming a
false-green or duplicate financial action. Real provider adapters still need
durable reconciliation, idempotency retention and a sandbox fault journey.
