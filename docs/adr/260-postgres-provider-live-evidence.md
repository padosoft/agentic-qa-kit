# ADR-260 — Protected PostgreSQL provider backup/restore evidence

## Status

Accepted — 2026-09-18

## Context

The CI PostgreSQL service already executes a synthetic `pg_dump`/`pg_restore`
journey. CI does not prove the operator's managed database endpoint or
credentials, and a green application health check is not recovery evidence.

## Decision

Expose the same bounded journey through a manual workflow bound to the
`production-database-evidence` Environment. It accepts only an operator-owned
disposable DSN, fails closed when absent, and never logs the DSN. The journey
creates and cleans up a uniquely named canary and verifies the restored digest.

## Consequences

- A successful run is evidence for that configured PostgreSQL provider at that
  time, without mutating customer data.
- The operator must supply an isolated target with appropriate temporary
  database privileges.
- PITR/WAL replay, retention, KMS, replication and production RTO/RPO are not
  inferred and remain explicit DR evidence obligations.
