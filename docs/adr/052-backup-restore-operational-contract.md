# ADR-052 — backup and restore operational contract

## Status

Accepted — 2026-09-17

## Decision

Production recovery is defined as a coordinated restore of scoped Postgres state, content-addressed run artifacts and redacted deployment configuration. Backup identity must include the database recovery point, artifact snapshot, schema/image versions and retention/residency policy. Restore is first performed in an isolated environment and must verify tenant isolation, audit integrity, queue fencing and artifact digests before writes reopen.

The application repository does not pretend to own KMS, WAL archiving, object-lock or cloud replication. Operators must supply those controls and attach drill evidence; local audit/run files and a healthy process are insufficient.

## Evidence

`docs/operations/dr-runbook.md` is the authoritative procedure. A live provider-specific backup and restore drill remains an explicit production gate.
