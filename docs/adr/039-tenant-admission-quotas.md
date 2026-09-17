# ADR-039: Tenant admission quotas

## Status

Accepted — distributed admission serialization shipped; configuration/metrics remain planned.

## Decision

The runner queue accepts optional positive integer limits for concurrent runs
and declared scenario units. Limits are scoped by the authenticated `org` and
`project` fields in the job payload. Jobs that exceed a limit fail closed with
`RESOURCE_QUOTA_EXCEEDED`; idempotent retries resolve to the original job
before quota evaluation.

The in-memory queue enforces the rule synchronously. The PostgreSQL adapter
uses the same rule inside a transaction-scoped advisory lock keyed by the
tenant/project scope, so the snapshot and insert are serialized across queue
clients. It must still emit quota utilization metrics and receive durable
configuration rather than only constructor options.

## Consequences

Queue overload is bounded and tenant isolation is preserved at the API error
boundary. CI proves concurrent PostgreSQL clients cannot both pass the same
scoped limit. Kill-switch propagation, configuration persistence, utilization
metrics and recovery after lease expiry remain separate operational work.
