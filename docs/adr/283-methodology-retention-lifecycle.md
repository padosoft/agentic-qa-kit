# ADR-283: Methodology artifact retention lifecycle

## Status

Accepted — 2026-09-19

## Context

Published methodology evidence needs an explicit retention boundary and a
protected deletion path. Immutable revisions alone do not define when evidence
may be archived or removed, and an operator must not delete data under legal
hold.

## Decision

- Each publication receives a tenant-scoped lifecycle record with bounded
  `retained_until` and `archive_after` timestamps. Defaults are 365 days;
  callers may choose shorter values within the supported range.
- Authenticated operators can archive a revision with a reason and set or
  release a legal hold. Archiving is refused while a legal hold is active.
- Reconciliation purges only expired, non-held revisions and their lifecycle
  records. Tenant scope is mandatory on API routes.
- Lifecycle records are validated on every persistence read. Memory is marked
  ephemeral; PostgreSQL is the durable adapter.

## Consequences

Retention behavior is explicit and testable across adapters. External WORM,
backup and independent audit-checkpoint evidence remain deployment-level final
promotion work; the local lifecycle is not a substitute for those controls.

