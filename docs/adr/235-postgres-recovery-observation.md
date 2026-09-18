# ADR-235 — Provider-backed PostgreSQL recovery observation

## Decision

Add a read-only PostgreSQL recovery observer to `@aqa/store`. It queries only
PostgreSQL recovery metadata (`pg_is_in_recovery`, replay LSN/timestamp,
transaction read-only state and server version), validates the provider result,
and emits a bounded record that contains no DSN, credentials or application
payloads.

The observer can connect through a real DSN or accept an injected query client
for deterministic tests. `assertPostgresRecoveryTarget` fails closed unless the
target is both in recovery and transaction read-only.

## Evidence boundary

This is stronger than a JSON-only restore contract because it observes a real
PostgreSQL target. It still does not claim that a cloud backup provider selected
the requested PITR point, restored object storage, or enforced KMS/WORM policy.
Those claims require provider-specific execution evidence and remain explicit
deployment gates in the DR runbook.
