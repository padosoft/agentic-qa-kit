# ADR-022 — Fail-closed reads for legacy tenant records

## Status

Accepted — 2026-09-17

## Context

Before tenant namespaces existed, configuration records were keyed globally.
Using those records as a fallback for a scoped request makes a missing tenant
assignment indistinguishable from an authorized read and can leak a profile,
risk, scenario or pack across projects.

## Decision

When a store method receives an `org` or `project` scope, both MemoryStore and
PostgresStore read and list only records in that namespace. Legacy unscoped
records are visible only to explicitly unscoped administrative operations.
There is no implicit compatibility fallback. Migration tooling must assign a
legacy record to an explicit tenant before it becomes visible to a scoped API.

## Consequences

Missing migration data is visible as a missing resource rather than a data
leak. Existing local projects with legacy YAML/configuration may need an
explicit import or migration step. This is a deliberate production safety
tradeoff; compatibility must not override tenant isolation.

