# @aqa/store

Storage abstraction. Single `StoreProvider` interface; two adapters:

- `MemoryStore` — default for tests and developer-local runs.
- `PostgresStore` — durable PostgreSQL adapter using idempotent schema creation,
  JSONB envelopes, tenant indexes, atomic create operations and a separate
  hash-addressed audit-event table. Refuses construction on empty DSN.

Swap adapter via configuration; the runner only depends on `StoreProvider`.

Set `AQA_TEST_POSTGRES_DSN` to run the optional integration contract against a
real PostgreSQL instance. Without that variable the default test command does
not invent a database. Production readiness still requires a PostgreSQL 16 CI
job, restart/backup drills, and an operational migration policy.
