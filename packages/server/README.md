# @aqa/server

Multi-team API server scaffold (Task 19 of the durable plan).

- `makeApi()` returns a framework-agnostic routing table — every handler
  takes a typed `{ headers, body, params }` and an `ApiContext`. The Hono
  wrapper lands in v0.6 once the on-prem deploy surface settles.
- `RunnerQueue` is an in-memory FIFO with visibility-timeout leases for local
  development. `PostgresRunnerQueue` provides the production boundary with
  row-locking, `SKIP LOCKED`, durable leases, reconnect recovery, and fencing
  tokens so a stale worker cannot acknowledge a reassigned job. When a verified
  runner identity is available, the lease is also fenced to that `runner_id`,
  preventing a different runner in the same project scope from renewing or
  ACKing it. The API accepts either implementation through `RunnerQueueLike`.

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

All non-GET API mutations accept an optional `Idempotency-Key`. The route
boundary binds it to tenant, method, route, parameters, request body and
`If-Match`; concurrent identical requests share one result, while changed
reuse returns `409`. `MemoryApiIdempotencyStore` is a single-process fallback.
Multi-replica production must inject a shared durable `ApiIdempotencyStore`
with atomic claim/insert and retention. `POST /api/runs` retains its queue-level
deduplication as a second defense.

The protected `POST /api/admin/migrate-legacy-configuration` endpoint performs
the explicit legacy configuration migration using `x-aqa-org` and/or
`x-aqa-project` scope headers. It requires `admin:everything` and never
silently falls back to global records.

`GET /api/risk-coverage` requires both tenant scope headers and
`risk-map:read`. It derives coverage from tenant-scoped risks, scenarios and
complete persisted `oracle_evaluated` event groups through
`@aqa/methodology`; incomplete scenario evidence is omitted rather than
reported as a pass.

Methodology revisions are exposed through the tenant-scoped
`GET /api/methodology/artifacts` and
`GET /api/methodology/artifacts/:id/:revision` routes. Publication through
`POST /api/methodology/proposals` creates a tenant-scoped pending proposal and
retains its bounded, DLP-checked envelope for review. The list route returns
metadata only; `GET /api/methodology/proposals/:id` returns the exact staged
envelope to an authorized reviewer. `POST /api/methodology/proposals/:id/approve`
performs the durable independent approval transition. `POST
/api/methodology/artifacts` then accepts only the approved proposal ID plus its
exact envelope. Agent-origin proposals require a host-owned verifier; bare
payloads, forged identities and mismatched approvals are rejected. The admin
console now exposes the review queue and digest-bound approval action; the
complete authenticated browser journey, reject reasons, revision diff and
retention/archive policy remain roadmap work.

The `aqa-budget-reaper` binary performs one PostgreSQL reservation cleanup tick
using `AQA_BUDGET_LEDGER_DSN`. It is intended for a Kubernetes CronJob or
systemd timer; it prints only a bounded count and fails when the DSN is absent.

The `aqa-runner-reaper` binary performs one PostgreSQL queue lease cleanup tick
using `AQA_RUNNER_QUEUE_DSN`. It requeues expired jobs below their retry limit
and terminally fails jobs at the limit. It is safe to run concurrently and is
intended for a CronJob/systemd timer; it never prints the DSN or job payload.

Run requests may include a bounded `priority` from `-10` to `10`. Higher
priorities are leased first and equal priorities remain FIFO. This is not a
fairness guarantee: production tenants needing starvation bounds still require
load-tested scheduling policy and quotas.

When `AQA_BUDGET_DSN` is configured, the admin API exposes tenant-scoped
`GET/POST /api/cost/halt`. Reads require `cost:read`; the emergency write
requires admin-only `cost:edit`, derives the ledger key from `x-aqa-org` and
`x-aqa-project`, and returns `503` when no durable controller is configured.

`AqaMcpServer` is the provider-neutral MCP control boundary. A host binds one
instance to an authenticated connection and injects an `McpRunPort`; the
allowlisted tools are limited to planning, starting, status, cancellation and
metadata-only evidence. Tenant scope is derived from `McpPrincipal`, starts
require an idempotency key, and raw event/tool payloads are never returned.
`McpHttpTransport` adds an authenticated Fetch-compatible JSON
request/response transport with bounded bodies and sessions, principal
binding, protocol checks, idle expiry and `DELETE` termination. It is
request/response only: hosts that need unsolicited SSE notifications must add
that stream with the same session boundary. Multi-replica deployments need
sticky routing or a shared session registry. For the built-in control-plane
binding, `createMcpRunPort(ctx)` delegates to the existing `RunnerQueue` and
`StoreProvider` with the same tenant fencing, profile validation, queue
idempotency and bounded evidence counts used by REST.
