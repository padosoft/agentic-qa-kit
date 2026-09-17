# ADR-136: Reconcile projections after SSE reconnect

**Status:** Accepted  
**Date:** 2026-09-17

## Context

Native `EventSource` retries a dropped connection, but an SSE transport cannot
prove that events emitted during the gap were delivered. Treating reconnect as
complete would leave the Runs and Findings projections stale without an obvious
error.

## Decision

The admin tracks the stream lifecycle. When a connection transitions from
`reconnecting` to `connected`, it emits a local `aqa:live-reconnected` signal;
Runs and Findings respond by refetching their tenant-scoped authoritative API
projections. Each received event also emits `aqa:live-event` so mounted
projections can refresh with low latency.

The stream still publishes SSE IDs and the AsyncAPI contract; durable cursor
replay is a future server-side enhancement. The client recovery fetch is a
safe baseline because it cannot manufacture completeness from a notification.

## Consequences

- A transient network gap converges to current server state when connectivity
  returns, even if one or more notifications were lost.
- Refetches are scoped to the same org/project headers as the initial reads.
- Event replay can later reduce refetch cost without changing the UI contract.
- Evidence: admin typecheck/build and ecosystem Playwright **3/3 passed**;
  reconnect simulation through a production reverse proxy remains deployment
  evidence.
