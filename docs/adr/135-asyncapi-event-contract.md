# ADR-135: Publish an AsyncAPI event contract

**Status:** Accepted  
**Date:** 2026-09-17

## Context

OpenAPI describes request/response routes but cannot express the live event
channel consumed by the admin and future integrations. The implementation plan
requires an AsyncAPI contract so event names, payload limits, tenant scope and
permissions are discoverable without reverse-engineering the bus.

## Decision

Generate an AsyncAPI 3.0 document from the server's supported live event type
registry and expose it as `GET /asyncapi.json`. The contract currently covers
`run.requested`, `run.cancelled`, and `finding.status_changed`, all carrying the
bounded tenant-scoped `BusEvent` envelope and requiring `runs:read`. SSE and
future WebSocket adapters share this event contract.

The document explicitly calls the events invalidation notifications: the
control-plane store remains authoritative and reconnect recovery must not infer
completeness from delivery alone.

## Consequences

- AsyncAPI tooling and integration owners have a machine-readable live event
  surface alongside OpenAPI.
- Adding a supported event requires changing one registry and the contract test
  catches missing operation/message generation.
- The current registry is intentionally limited to events emitted by the API;
  runner/audit event families need separate versioned channels before they are
  exposed externally.
- Evidence: server contract test and admin HTTP test pass; the emitted document
  is covered by local typecheck and lint.
