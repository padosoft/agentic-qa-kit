# ADR-137: Durable cursor replay for live events

**Status:** Accepted  
**Date:** 2026-09-17

## Context

SSE reconnects can lose notifications between the last received event and the
new subscription. A reconnect refetch is the correctness fallback, but it is
expensive and does not expose whether the cursor was outside the retained
history. `LISTEN/NOTIFY` alone cannot answer that question.

## Decision

Extend the provider-neutral `EventBus` with optional bounded replay. The
in-memory bus keeps a 1,000-event history for deterministic development and
tests. `PostgresEventBus` persists events before `NOTIFY` in
`aqa_live_events`, assigns a monotonic identity sequence, and replays at most
500 tenant-scoped events after `Last-Event-ID`.

The Node SSE adapter subscribes before replaying to avoid a delivery race,
deduplicates by event ID, and emits `stream.gap` when the cursor is missing or
replay is unavailable. The browser continues to refetch authoritative
projections on reconnect; replay is an optimization, not proof of completeness.

## Consequences

- A reconnect can recover recent events without waiting for a full projection
  refresh.
- Tenant and project filters are applied server-side before writing SSE data.
- Missing/expired cursors remain observable and trigger a safe refetch path.
- PostgreSQL retention, pruning, migration rollout and HA failover tests are
  still operational requirements before claiming production completeness.
