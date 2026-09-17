# ADR-083 — Read-only SQL probe driver

## Status

Accepted — 2026-09-17

## Decision

`@aqa/runner` provides `makeSqlProbeRunner()` with an injected database
adapter. The probe accepts a SQL string plus separate parameters, allows one
`SELECT`, `WITH` or `EXPLAIN` statement, caps returned rows and redacts
sensitive column names and common PII patterns before returning evidence.

## Rationale

Commerce invariants such as order totals, inventory reservations, payment
ledger entries and webhook idempotency require an authoritative read observer.
HTTP-only assertions can validate a response while missing a durable mismatch.
The runner must not own credentials or a connection pool, and a pack must not
be able to mutate the database through a QA observation probe.

## Limits

The lexical read-only guard is defense in depth, not a database permission
boundary. Production adapters must use a dedicated read-only database role,
statement timeout, row/byte limits and tenant-scoped views. Postgres/SQLite
connection adapters and live ecommerce journeys remain separate integration
work.
