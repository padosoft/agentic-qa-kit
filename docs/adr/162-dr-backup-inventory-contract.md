# ADR-162: Machine-validatable DR backup inventory

## Status

Accepted

## Context

The DR runbook requires operators to record database PITR, artifact snapshot,
schema/image versions, drill identity and recovery objectives. A Markdown note
is difficult to validate consistently and can omit the digest that binds the
recovery set.

## Decision

`@aqa/compliance` exposes `BackupInventory`, `parseBackupInventory`,
`canonicalBackupInventory` and `backupInventorySha256`. The parser requires
bounded identifiers, UTC timestamps, PostgreSQL LSN syntax, lowercase SHA-256
artifact digests, immutable `sha256:` image digests, positive object/objective
counts and the explicit schema version. The canonical representation is the
only representation to hash or sign.

## Evidence and boundary

The compliance suite passes 12/12 locally. This provides a validated evidence
format; it does not provision WAL archiving, KMS, Object Lock or perform a
restore drill. Those remain infrastructure evidence.
