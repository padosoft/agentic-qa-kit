# ADR-030: Idempotent run enqueue

## Status

Accepted

## Context

HTTP clients retry requests after timeouts and proxies can replay a request.
Creating a second runner job for the same user action can execute a release
gate twice, consume budget twice, or duplicate downstream side effects.

## Decision

`POST /api/runs` requires an explicit org/project scope and accepts the
standard `Idempotency-Key` header. The request payload is canonically
fingerprinted and bound to a tenant-qualified key. Memory and PostgreSQL queue
implementations return the original job for an identical retry and reject a
changed payload with `409 IDEMPOTENCY_CONFLICT`. PostgreSQL enforces uniqueness
with a partial unique index and performs the read-after-conflict comparison.

## Consequences

- Retries are safe across API replicas sharing the durable queue.
- Keys are bounded to 200 characters and never logged.
- A queue record remains the authoritative idempotency result; retention and
  cleanup policy must be added before unbounded long-term key storage.
- Requests without a key remain at-least-once by explicit caller choice.
