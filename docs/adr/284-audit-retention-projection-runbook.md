# ADR-284: Audit retention is a checkpointed projection operation

## Status

Accepted

## Context

Audit events are hash chained. Naively deleting old rows or a filesystem prefix
can make a shortened chain appear valid while losing completeness evidence.
The admin also needs bounded projections and aggregates without weakening
tenant isolation.

## Decision

Treat audit retention as a checkpointed operational projection: scope and
filter at the store boundary, verify chain/checkpoint coverage before archive
or purge, honor legal hold, and require provider read-back evidence before a
destructive step. The repository documents the procedure in the audit
retention runbook and keeps provider immutability as a separate final gate.

## Consequences

- Counts and pages can be bounded without claiming completeness.
- Retention cannot silently become a chain-truncation vulnerability.
- Local development remains usable without provider credentials.
- Production promotion still requires WORM/KMS/PITR and independent assurance
  evidence; documentation alone never upgrades that status.
