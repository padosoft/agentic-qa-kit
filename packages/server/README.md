# @aqa/server

Multi-team API server scaffold (Task 19 of the durable plan).

- `makeApi()` returns a framework-agnostic routing table — every handler
  takes a typed `{ headers, body, params }` and an `ApiContext`. The Hono
  wrapper lands in v0.6 once the on-prem deploy surface settles.
- `RunnerQueue` is an in-memory FIFO with visibility-timeout leases for local
  development. `PostgresRunnerQueue` provides the production boundary with
  row-locking, `SKIP LOCKED`, durable leases, reconnect recovery, and fencing
  tokens so a stale worker cannot acknowledge a reassigned job. The API accepts
  either implementation through `RunnerQueueLike`.

Permission gates use `@aqa/auth`'s `allows()` predicate. Storage uses
`@aqa/store`'s `StoreProvider` — MemoryStore in tests, PostgresStore in
production. `aqa admin` selects `PostgresRunnerQueue` when `AQA_QUEUE_DSN` is
configured and `PostgresStore` when `AQA_STORE_DSN` is configured; otherwise it
intentionally uses local in-memory components for development.

`MemoryEventBus` is the deterministic local transport. `PostgresEventBus`
provides cross-replica `LISTEN/NOTIFY` fan-out for self-hosted deployments.
It is intentionally not a durable queue: publishers persist authoritative
state first, and consumers reconcile after reconnects. Payloads are bounded to
7,500 UTF-8 bytes to stay below PostgreSQL notification limits; subscriber
failures are isolated from publishers.

The protected `POST /api/admin/migrate-legacy-configuration` endpoint performs
the explicit legacy configuration migration using `x-aqa-org` and/or
`x-aqa-project` scope headers. It requires `admin:everything` and never
silently falls back to global records.
