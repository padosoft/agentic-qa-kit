# ADR-282: Tenant-safe audit provenance at the store boundary

## Status

Accepted

## Context

Audit events are hash-chained records, but tenant identity is persistence
metadata rather than part of the event hash payload. Older producer paths could
leave PostgreSQL `org`/`project` columns null, while scoped projections treated
null as globally visible. That is unsafe for a multi-tenant control plane.

## Decision

When an event has a `run_id`, the store derives tenant metadata from the
persisted run. A trusted caller may provide an explicit `StoreScope` override.
The MemoryStore records the same projection metadata for test parity.

Scoped audit reads require exact metadata matches and exclude legacy events with
missing provenance. Unscoped local/audit reads retain access to all records for
reconciliation and migration tooling.

## Consequences

- New run and finding audit events are tenant-addressable without mutating the
  hash payload or weakening canonical verification.
- Legacy rows remain queryable unscoped but are intentionally absent from
  tenant-scoped projections until backfilled or explicitly migrated.
- Every future producer must either bind a run or pass an authoritative scope;
  tests must cover both same-tenant visibility and cross-tenant exclusion.
