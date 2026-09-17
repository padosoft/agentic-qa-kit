# ADR-133: Tenant-scoped live event stream

**Status:** Accepted  
**Date:** 2026-09-17

## Context

The admin panel had a durable event history and an event bus, but no real-time
transport. Polling loses operator visibility during long runs, while an
unfiltered pub/sub feed could leak another tenant's activity.

## Decision

Expose `GET /api/events/stream` as an authenticated Server-Sent Events endpoint
in the Node admin adapter. Authenticate with the normal admin identity, require
`runs:read`, require an organization scope, and apply optional project scope
filtering before writing any event. The stream sends a reconnect hint, bounded
heartbeat comments, event IDs/types, and JSON data. Disconnect and abort handlers
unsubscribe from the bus and stop the heartbeat.

The route remains present in the framework-agnostic route table for discovery
and authorization metadata. Adapters that cannot stream return an explicit 501
rather than pretending a JSON response is live. The event bus remains a
low-latency hint transport; clients reconcile authoritative state after gaps.

## Consequences

- Long-running admin views can update without polling.
- Tenant filtering is enforced server-side, including for query-based browser
  EventSource clients that cannot send custom headers.
- Native EventSource does not carry arbitrary bearer headers; deployments should
  use the existing same-origin session cookie or an edge-authenticated channel,
  never put access tokens in the URL.
- Evidence: a real HTTP stream test verified headers, initial retry frame,
  positive tenant delivery, negative tenant filtering, and disconnect cleanup.
  Multi-replica reconnect/replay and production proxy buffering checks remain
  deployment evidence.
