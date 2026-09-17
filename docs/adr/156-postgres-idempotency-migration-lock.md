# ADR-156 — Serialize PostgreSQL idempotency schema bootstrap

## Status

Accepted — 2026-09-17

## Context

The durable API idempotency store is instantiated by multiple server replicas
and by parallel integration contracts. `CREATE TABLE IF NOT EXISTS` alone does
not serialize concurrent first boot: PostgreSQL can race while creating the
relation type and fail with a duplicate `pg_type` entry.

## Decision

Guard the idempotency table and index bootstrap with a session-scoped
PostgreSQL advisory lock and always release it in `finally`. This mirrors the
existing serialized bootstrap boundaries and is safe across replicas sharing
the same database.

## Evidence

The hosted PostgreSQL contract previously failed with a duplicate relation
type during concurrent test startup. The next CI run must pass the same
parallel contract; local verification without `AQA_TEST_POSTGRES_DSN` cannot
prove this database race is fixed.
