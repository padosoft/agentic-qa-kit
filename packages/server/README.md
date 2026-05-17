# @aqa/server

Multi-team API server scaffold (Task 19 of the durable plan).

- `makeApi()` returns a framework-agnostic routing table — every handler
  takes a typed `{ headers, body, params }` and an `ApiContext`. The Hono
  wrapper lands in v0.6 once the on-prem deploy surface settles.
- `RunnerQueue` is an in-memory FIFO with visibility-timeout leases — runner
  workers poll `/api/runner/jobs/next`, the lease auto-reclaims if the worker
  dies.

Permission gates use `@aqa/auth`'s `allows()` predicate. Storage uses
`@aqa/store`'s `StoreProvider` — MemoryStore in tests, PostgresStore (Task 13
follow-up) in production.
