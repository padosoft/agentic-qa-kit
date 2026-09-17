# ADR-087 — Postgres read-only probe adapter

## Status

Accepted — 2026-09-17

## Decision

`makePostgresSqlProbeRunner()` is the first concrete database adapter for the
read-only SQL driver. It uses a single-connection Postgres client, runs every
probe in a `READ ONLY` transaction, applies a local `statement_timeout`, and
delegates query shape, parameter validation, row limits and redaction to the
generic SQL boundary. It exposes `close()` for orchestration-owned shutdown.

## Rationale

Commerce assertions need authoritative order, inventory and ledger reads. The
adapter provides a real integration path while keeping the connection string
out of scenarios and artifacts. A CI contract test runs `SELECT 1` against the
existing PostgreSQL service; local runs explicitly report a skip when no DSN is
configured.

## Limits

Production still needs a dedicated least-privilege Postgres role, tenant-scoped
views/RLS, TLS, secret-manager injection and query observability without DSN
logging. The `SELECT 1` contract proves connectivity and transaction policy,
not a merchant schema or provider reconciliation journey.
