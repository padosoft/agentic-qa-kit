# ADR-246 — Execute a PostgreSQL backup/restore journey in CI

## Decision

The hosted PostgreSQL integration job creates a uniquely named synthetic
canary table, records a canonical row digest, runs `pg_dump` in custom format,
creates an isolated database, restores it with `pg_restore`, and reads the
restored rows through a fresh connection. Mismatch, missing rows or command
failure fail the job. Cleanup runs for both successful and failed journeys and
logs never contain the DSN or payload values.

## Boundary

This is provider-backed PostgreSQL backup/restore evidence for the CI
PostgreSQL service. It proves neither managed-cloud PITR/WAL replay nor KMS,
WORM/Object Lock, cross-region replication or measured production RTO/RPO.
Those controls remain deployment-specific evidence and are not inferred from
this test.
