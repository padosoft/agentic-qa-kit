# ADR-283: Tenant-scoped audit aggregation

## Status

Accepted

## Context

The admin audit surface needs counts by event kind and time window. Computing
those counts in the API from a global event list would transfer unnecessary
payloads and could create a cross-tenant side channel.

## Decision

Expose `summarizeAuditEvents` in the store contract and implement the same
tenant, kind and time-window predicates as `listAuditEvents`. PostgreSQL groups
inside SQL; MemoryStore uses the same filtered semantic projection for local
parity. The API exposes the result through `GET /api/audit/summary`.

## Consequences

- Tenant scope remains enforced at the persistence projection boundary.
- Durable deployments avoid materializing event payloads for dashboard counts.
- Future retention jobs can use the same projection contract without changing
  the admin API semantics.
- The summary is not a WORM/compliance retention mechanism; those controls
  remain part of the final production gate.
