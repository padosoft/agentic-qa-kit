# @aqa/store

Storage abstraction. Single `StoreProvider` interface; two adapters:

- `MemoryStore` — default for tests and developer-local runs.
- `PostgresStore` — scaffold; full drizzle-orm implementation lands with
  the server extraction (Task 19). Refuses construction on empty DSN.

Swap adapter via configuration; the runner only depends on `StoreProvider`.
