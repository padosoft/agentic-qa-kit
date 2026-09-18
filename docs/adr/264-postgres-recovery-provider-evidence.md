# ADR-264: Protected read-only PostgreSQL recovery observation

## Decision

Provide a manual protected workflow that connects to the actual recovered
PostgreSQL target and validates recovery mode, transaction read-only state and
optional replay identity using the repository's SELECT-only observer.

## Rationale

The dump/restore journey proves compatibility with a configured PostgreSQL
client, while the recovery observer proves the post-restore target posture.
Neither should be mislabeled as cloud PITR or WAL-provider evidence; keeping
the observations separate makes the DR release gate auditable.

## Safety boundary

The workflow requires an isolated operator-owned target and a protected DSN,
performs no writes, and never logs the connection string or row payload.
