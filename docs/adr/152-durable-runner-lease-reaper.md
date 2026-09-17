# ADR-152 — Durable runner lease reaper

## Status

Accepted — 2026-09-17

## Context

Queue workers normally reclaim expired leases when they call `dequeue()`. That
couples recovery to worker availability: after a fleet-wide outage, orphaned
jobs remain `in_flight`, are not visible to operators, and have no independent
metric or scheduled recovery boundary.

## Decision

Add `reapExpired()` to `RunnerQueueLike`. The in-memory adapter applies the
same transition deterministically. The PostgreSQL adapter performs one atomic
set-based update: expired jobs below `max_attempts` return to `queued`; jobs at
the limit become `failed` with a bounded reason; both transitions clear the
lease token so stale workers remain fenced. The operation returns only counts.

Ship `aqa-runner-reaper`, a one-shot process requiring the Secret-backed
`AQA_RUNNER_QUEUE_DSN`, plus an optional Helm CronJob with `Forbid` concurrency
and non-root/read-only security settings.

This does not prove that an interrupted external probe was compensated. A
requeued job may execute again, so probe handlers must remain idempotent or use
their own provider-specific effect ledger. The reaper is queue recovery, not a
generic side-effect rollback mechanism.

## Evidence boundary

Unit tests cover memory transitions and the PostgreSQL contract runs when
`AQA_TEST_POSTGRES_DSN` is supplied. Helm rendering verifies deployment shape;
production readiness still requires live alerting, a multi-replica crash drill
and evidence that the configured handler/provider is safe to retry.
