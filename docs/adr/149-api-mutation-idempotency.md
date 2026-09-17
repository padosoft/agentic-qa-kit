# ADR-149: Route-bound idempotency for API mutations

## Status

Accepted

## Context

The runner queue already deduplicated `POST /api/runs`, but other API mutations
could execute twice when clients retried after a lost response. Implementing
idempotency separately in every handler would leave inconsistent semantics and
miss newly added routes.

## Decision

Wrap every non-GET API route returned by `makeApi()`. A valid
`Idempotency-Key` is scoped by tenant, method and route, and its fingerprint
includes route parameters, body and `If-Match`. Concurrent identical requests
share one promise; a reused key with a different fingerprint returns `409`;
responses with status below 500 are retained for seven days by the memory
implementation. The wrapper does not cache server failures.

`MemoryApiIdempotencyStore` is a local fallback only. Production deployments
must inject a shared durable implementation, with atomic claim/insert and a
retention policy, so process restarts and replicas cannot re-execute a mutation.

## Consequences

- New mutation routes inherit the contract automatically.
- Existing handler-specific queue deduplication remains as a second defense.
- A durable store is still required for enterprise multi-replica guarantees;
  local fallback behavior is intentionally documented as non-production.
- The API can safely replay a deterministic response after a client timeout,
  while transient server failures remain retryable.
