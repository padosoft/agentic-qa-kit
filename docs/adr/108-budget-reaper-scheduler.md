# ADR-108: budget reservation reaper scheduler

- Status: Accepted
- Date: 2026-09-17

## Decision

`BudgetReaper` wraps any `BudgetLedger` and provides `runOnce(now)`,
`start()` and `stop()`. The interval is validated (minimum 100 ms), repeated
start/stop calls are safe, overlapping ticks are skipped, and failures are
delivered to an injected callback. Deployment adapters can use `runOnce` from a
Kubernetes CronJob/systemd timer, while embedded control planes may use the
managed interval.

## Consequences

- Orphaned reservations have a reusable operational trigger rather than relying
  on a caller to remember cleanup.
- Metrics, alerting and leader/concurrency policy remain deployment concerns;
  PostgreSQL `SKIP LOCKED` makes multiple reapers safe to run.

## Verification

Cost build/typecheck and tests pass locally with **11 tests and 0 failures**.
