# ADR-109: deploy the budget reservation reaper as a one-shot job

- Status: Accepted
- Date: 2026-09-17

## Decision

Ship `aqa-budget-reaper`, a one-shot server-package binary that opens a
`PostgresBudgetLedger`, performs one `BudgetReaper.runOnce()` tick, prints only
the bounded reaped count, and closes the connection. It requires
`AQA_BUDGET_LEDGER_DSN` and exits non-zero when absent.

The Helm chart exposes `cost.reaper.enabled`, schedule, command and optional
Secret reference. Enabled deployments render a `batch/v1 CronJob` with
`concurrencyPolicy: Forbid`, bounded history/backoff, Secret-backed DSN,
non-root, RuntimeDefault seccomp, no service-account token, read-only root
filesystem and dropped capabilities. Template rendering fails when no DSN
Secret source is configured.

## Consequences

- Reservation cleanup is deployable without keeping a server replica alive.
- The chart does not log credentials or inline DSNs.
- Metrics/alerts for reaper failures remain platform responsibilities; CI renders
  and asserts the production-shaped CronJob.

## Verification

Server build/typecheck and suite pass locally (122 tests, 0 failures). The
missing-DSN binary path fails closed. Helm lint/render is executed in CI because
Helm is unavailable in this Windows workspace.
