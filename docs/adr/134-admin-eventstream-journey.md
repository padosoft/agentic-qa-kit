# ADR-134: Prove live events through the browser journey

**Status:** Accepted  
**Date:** 2026-09-17

## Context

An HTTP SSE integration test proves that bytes can be written, but not that the
production SPA opens the stream, parses custom event types, renders connection
state, and receives a tenant-scoped event. The existing admin UI also labelled
simulated terminal output as SSE, which made that distinction easy to miss.

## Decision

The admin app opens `EventSource` when `VITE_AQA_SERVER_URL` is configured,
surfaces `connecting`, `connected`, and `reconnecting` state, parses the known
server event types, and dispatches a browser event for projection refreshes. The
ecosystem stack now uses a real memory event bus and publishes a fixture event
only after a stream subscriber exists. A Playwright journey asserts the visible
connected state and the received `run.requested` event.

SSE remains an invalidation channel; durable API reads remain authoritative.

## Consequences

- The UI no longer claims a live stream solely because a terminal animation is
  present.
- Browser and adapter timing is deterministic enough to expose regressions in
  CORS, EventSource parsing, custom event names, or tenant routing.
- Reconnect cursor/replay semantics are still needed for events missed during a
  network gap; automatic EventSource retry alone is not durable recovery.
- Evidence: ecosystem Playwright **3/3 passed**, including the new browser
  stream journey; admin typecheck/build and repository lint passed.
