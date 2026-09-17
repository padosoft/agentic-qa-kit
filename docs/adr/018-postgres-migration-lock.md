# ADR-018: Serialize PostgreSQL store migrations

- Status: accepted
- Date: 2026-09-17

## Context

The store can be started by multiple control-plane replicas at once. Although
each DDL statement used `IF NOT EXISTS`, the migration sequence also writes the
schema-version marker and creates dependent indexes. Statement-level
idempotency does not serialize that sequence.

## Decision

Run the PostgreSQL store bootstrap in one transaction guarded by
`pg_advisory_xact_lock(hashtext('aqa_store_schema'))`. The lock is released by
PostgreSQL on commit/rollback, and failures roll back the entire bootstrap.

## Consequences

Fresh replicas converge on one schema safely and existing installations remain
compatible. Future forward-only migrations must be added inside this same
transactional runner and record a new schema version; no destructive down
migrations are exposed by the production adapter.
