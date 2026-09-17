# ADR-156 — Serialize PostgreSQL schema bootstraps with transaction locks

## Status

Accepted — 2026-09-17

## Context

Several durable PostgreSQL adapters are instantiated by multiple server
replicas and by parallel integration contracts. `CREATE TABLE IF NOT EXISTS`
alone does not serialize concurrent first boot: PostgreSQL can race while
creating the relation type and fail with a duplicate `pg_type` entry. A
session-scoped advisory lock is also unsafe through a connection pool because
the lock, DDL, and unlock calls are not guaranteed to use the same session.

## Decision

Guard each complete bootstrap sequence with a transaction-scoped
`pg_advisory_xact_lock` executed on the transaction client. The API idempotency
store, runner queue, and LLM budget ledger now use this pattern. The database
releases the lock on commit or rollback, so pooled connections cannot leak or
silently lose the lock between migration statements.

## Evidence

The hosted PostgreSQL contract previously failed with a duplicate relation
type during concurrent test startup. Local verification without
`AQA_TEST_POSTGRES_DSN` cannot prove this database race is fixed; the next
hosted CI run must pass the same parallel contract.

The same hosted contract also exposed a cross-runtime JSONB representation
gap: cached bodies and nullable headers could be returned as serialized strings
by the PostgreSQL driver. The adapter now decodes those values before exposing
the shared `ApiResponse` contract.
