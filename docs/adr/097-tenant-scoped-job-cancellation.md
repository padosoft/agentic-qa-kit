# ADR-097 — Tenant-scoped durable job cancellation

## Status

Accepted — 2026-09-17

## Decision

Queued and leased runner jobs can transition to a terminal `cancelled` state
through a tenant-scoped API operation. Memory and PostgreSQL queues clear the
lease/fencing token and retain a bounded operator reason. ACK and retry paths
cannot revive a cancelled job; cross-tenant requests return not-found.

## Rationale

Cancellation is not successful completion. A distinct durable state preserves
release-gate semantics and lets workers cooperate with an operator abort
without accepting stale results.

## Limits

The queue mutation does not interrupt arbitrary code already running in a
worker. Worker polling/heartbeat must observe cancellation and propagate an
`AbortSignal` to the active driver; provider-specific cancellation remains
deployment work.
