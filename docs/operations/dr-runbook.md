# AQA Kit — backup, restore and disaster-recovery runbook

Status: operational contract — 2026-09-17

This runbook defines the production boundary. A Postgres dump plus an artifact-store snapshot are the recovery set; the audit PVC or a local `.aqa/runs` directory is not a backup. Never put credentials, connection strings or customer payloads in the evidence produced by a drill.

## Recovery objectives

The service owner must set and record these values before production:

| Objective | Required input | Evidence |
| --- | --- | --- |
| RPO | maximum accepted data loss, in minutes | backup schedule and last successful backup timestamp |
| RTO | maximum restore-to-serving time, in minutes | timed restore drill |
| Retention | legal/security retention and deletion window | immutable retention policy |
| Residency | permitted backup regions/accounts | storage policy and provider configuration |

The default design target is RPO ≤ 15 minutes with WAL/PITR and RTO ≤ 60 minutes for a single-region failure, but an operator must replace those targets with an approved service objective.

## Backup contract

1. Enable Postgres continuous archiving/WAL plus daily full base backup. Encrypt in transit and at rest with the organization’s KMS; keep the key lifecycle separate from the database account.
2. Enable versioning, retention lock and cross-account replication for the artifact store. Preserve the content digest and metadata for every run artifact.
3. Back up deployment configuration as redacted, versioned manifests. Secret values are restored from the secret manager, never from Git or a backup Markdown file.
4. Record a backup inventory containing timestamp, database LSN/PITR target, artifact snapshot identifier, schema version, application image digest and operator/run ID.
5. Alert on missed backups, failed WAL archiving, retention-lock drift and replication lag. A green application health endpoint is not backup evidence.

## Restore procedure

1. Freeze new runs and external callbacks. Preserve the incident timeline and stop destructive retries.
2. Provision an isolated recovery project/cluster with the approved application image and no public ingress.
3. Restore Postgres to the selected PITR target, apply forward-only migrations, and verify the schema version.
4. Restore artifacts into a new prefix/bucket. Verify every metadata digest and reject missing, changed or path-escaping objects.
5. Start the server and runner with the recovered store. Run read-only health, tenant-isolation, audit-chain and queue-fencing checks before opening writes.
6. Compare counts and digests for runs, findings, events, users, tokens (without exporting raw secrets) and artifact references. Reconcile records created after the PITR target according to the incident decision.
7. Re-enable writes, then callbacks and scheduled jobs in that order. Keep the original environment read-only until reconciliation is signed off.

## Quarterly restore drill

Run the procedure against a disposable environment with synthetic tenant data and canary secrets. Capture start/end timestamps, chosen PITR, image/schema versions, restore errors, object-digest results, tenant-denial results and queue behavior. The drill fails if data is silently skipped, a canary secret appears in output, a cross-tenant read succeeds, an old lease can ACK, or the measured RTO/RPO misses the approved objective.

## Current repository boundary

The repository provides scoped Postgres storage, content-addressed artifact references, redaction and queue fencing. It does not provision a cloud backup service, KMS, WAL archiver or immutable object-lock policy. Those are deployment obligations; this document is not evidence that a live backup or restore has run. A release claiming DR readiness must attach a fresh drill record with infrastructure-specific evidence.
