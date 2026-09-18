# PostgreSQL provider evidence

The manual `postgres-provider-evidence.yml` workflow runs the repository's
bounded backup/restore journey against an operator-owned disposable PostgreSQL
provider. It creates a synthetic canary table, computes a canonical digest,
executes `pg_dump` and `pg_restore` into an isolated database, compares the
restored rows and digest, then removes the temporary objects.

Configure the protected GitHub Environment `production-database-evidence` with
one secret:

- `AQA_TEST_POSTGRES_DSN` — a dedicated, disposable evidence database whose
  credentials have the privileges needed for a temporary table, `CREATEDB` and
  cleanup. Never point it at an application or customer production database.

The DSN is passed only through the process environment and is never printed or
written to the evidence. The workflow fails before connecting if it is absent.

This proves provider connectivity, dump/restore compatibility and row-level
integrity for the configured PostgreSQL service. It does not prove managed
cloud PITR/WAL replay, backup retention, KMS encryption, cross-region
replication or measured production RTO/RPO. Those remain separate DR exercises
and must be joined with the signed release evidence described in the DR
runbook.
