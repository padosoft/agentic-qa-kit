# @aqa/store

Storage abstraction. Single `StoreProvider` interface; two adapters:

- `MemoryStore` — default for tests and developer-local runs.
- `PostgresStore` — durable PostgreSQL adapter using idempotent schema creation,
  JSONB envelopes, tenant indexes, atomic create operations and a separate
  hash-addressed audit-event table. Refuses construction on empty DSN.
- `observePostgresRecoveryAtDsn()` — SELECT-only, redacted observation of a
  PostgreSQL PITR target, with an injected-client variant for deterministic
  tests and a fail-closed recovery/read-only assertion.

Swap adapter via configuration; the runner only depends on `StoreProvider`.

Methodology artifacts use `saveMethodologyArtifact`,
`loadMethodologyArtifact` and `listMethodologyArtifacts`. Both adapters
re-validate the versioned envelope before persistence, isolate records by
`org`/`project`, retain every revision, and reject a second payload for the
same artifact revision. Postgres uses an atomic insert-on-conflict boundary,
revalidates envelopes on reads, and scopes SQL by exact tenant columns. The
shared DLP policy rejects payloads that would be redacted before hashing;
provider retention, authorization middleware and UI approval remain above this
storage contract.

Legacy global configuration is never exposed through scoped reads. An
administrator can explicitly move packs, profiles, risks and scenarios to a
tenant with `migrateLegacyConfiguration({ org, project })`; the operation is
fail-closed on destination conflicts and does not migrate runs, findings or
identity data.

Set `AQA_TEST_POSTGRES_DSN` to run the optional integration contract against a
real PostgreSQL instance. Without that variable the default test command does
not invent a database. The PostgreSQL CI job also runs a real `pg_dump` →
isolated database → `pg_restore` → fresh-read digest journey using synthetic
data. This proves restore integrity for that CI PostgreSQL boundary; it does
not prove cloud PITR/WAL archiving, KMS, Object Lock, replication or production
RTO/RPO.

The protected manual `postgres-provider-evidence.yml` workflow repeats the
same bounded journey against an operator-owned disposable PostgreSQL provider.
Its DSN is an Environment secret and the job fails closed when it is absent;
never point it at a customer or application production database.
