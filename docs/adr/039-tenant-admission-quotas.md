# ADR-039: Tenant admission quotas

## Status

Accepted — first enforcement slice; distributed atomicity remains planned.

## Decision

The runner queue accepts optional positive integer limits for concurrent runs
and declared scenario units. Limits are scoped by the authenticated `org` and
`project` fields in the job payload. Jobs that exceed a limit fail closed with
`RESOURCE_QUOTA_EXCEEDED`; idempotent retries resolve to the original job
before quota evaluation.

The in-memory queue enforces the rule synchronously. The PostgreSQL adapter
uses the same rule and a durable snapshot, but its snapshot-plus-insert window
is explicitly advisory under concurrent replicas. Production-grade distributed
admission requires a transaction with serialized counters or an equivalent
PostgreSQL advisory-lock protocol and must emit quota utilization metrics.

## Consequences

Queue overload is bounded and tenant isolation is preserved at the API error
boundary. Operators can configure safe local limits today, while CI and the
next implementation slice must prove atomic contention behavior, kill-switch
propagation, and recovery after lease expiry.
