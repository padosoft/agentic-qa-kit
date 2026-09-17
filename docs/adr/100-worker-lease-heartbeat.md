# ADR-100: worker lease heartbeat and fencing

- Status: Accepted
- Date: 2026-09-17

## Context

Visibility leases prevent a dead worker from blocking a queue, but a legitimate
long-running scenario can outlive the initial lease. Without renewal, a second
worker may receive the same job while the first still writes results. A late ACK
is already fenced, but the first worker should also stop its provider work as
soon as it loses ownership.

## Decision

Queue adapters expose `renew(id, lease_token, now?)`. Renewal succeeds only for
the current `in_flight` row and exact fencing token, and extends the lease by
the configured visibility interval. `RunnerWorker` renews during handler
execution. If the job is cancelled, it reports `cancelled`; if the row leaves
`in_flight` or renewal rejects the token, it aborts and reports `lease_lost`.
Neither path ACKs or writes a failure through the stale lease.

## Consequences

- Long jobs can retain ownership without disabling visibility timeouts.
- Reassignment remains safe: stale workers are stopped cooperatively and their
  tokens cannot mutate the new owner’s state.
- The provider handler must honor `AbortSignal`; OS-level kill is not implied.
- Heartbeat cadence and lease duration still require production tuning and
  metrics, and the PostgreSQL live contract must verify renewal across clients.

## Verification

`bun run --cwd packages/server build` and `bun test --cwd packages/server` pass
with **122 tests and 0 failures** locally. PostgreSQL live tests remain skipped
without `AQA_TEST_POSTGRES_DSN`.
