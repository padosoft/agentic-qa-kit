# ADR-147: Serialize PostgreSQL live-event schema bootstrap

## Status

Accepted

## Decision

`PostgresEventBus` acquires a transaction-scoped PostgreSQL advisory lock before
creating the durable live-event table and its index. The lock key is stable
across replicas and is released automatically when the bootstrap transaction
commits or rolls back.

## Context

`CREATE TABLE IF NOT EXISTS` alone does not make concurrent first boot safe
when the table contains an identity column. Two replicas can race while
PostgreSQL creates the implicit identity sequence, causing one startup to fail
with a duplicate relation error even though the table was declared with
`IF NOT EXISTS`.

## Consequences

- Concurrent replicas can initialize the schema safely.
- Only the short DDL bootstrap section is serialized; event publish and
  LISTEN/NOTIFY remain concurrent.
- The advisory lock is PostgreSQL-specific and intentionally belongs in the
  Postgres adapter, not the provider-neutral `EventBus` contract.
