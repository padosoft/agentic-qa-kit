# ADR-025 — Explicit legacy configuration migration

## Status

Accepted — 2026-09-17

## Context

Older installations may contain globally keyed packs, profiles, risks and
scenarios. Transparent fallback makes an unassigned record look authorized to
a tenant and can leak configuration across projects.

## Decision

Expose an administrator-only `POST /api/admin/migrate-legacy-configuration`
operation. The destination is taken exclusively from authenticated scope
headers; at least one of `x-aqa-org` or `x-aqa-project` is required. The store
preflights every legacy record, refuses the whole operation when any target
key conflicts, and otherwise moves all four configuration kinds atomically
for PostgreSQL. MemoryStore mirrors the same fail-closed result contract.

## Consequences

Migration is auditable and repeatable without reintroducing read fallback.
The operation must be run separately for each intended tenant, and operators
must review the conflict list before resolving collisions. The endpoint is
protected by `admin:everything`; it is not a general-purpose import of runs,
findings or identity data.
