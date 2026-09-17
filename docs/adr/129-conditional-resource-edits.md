# ADR-129: Conditional admin resource edits

**Status:** Accepted  
**Date:** 2026-09-17

## Context

Profile, risk-map and scenario editors were protected by schema validation but
their update endpoints were last-write-wins. Two operators could read the same
resource, save different edits, and silently lose one change. The admin-core
package already described conflict detection, but the HTTP boundary had no
version token.

## Decision

GET detail endpoints emit a strong content ETag. PUT endpoints for profiles,
risks and scenarios honor `If-Match`; a stale tag returns `412
PRECONDITION_FAILED` and performs no write, including the current ETag for
recovery. Requests without `If-Match` remain backward-compatible during the
migration, while clients progressively adopt conditional writes.

## Consequences

- API clients can implement safe optimistic concurrency without relying on
  client clocks or in-memory versions.
- The current admin forms still need to capture and send ETags on their full
  edit journeys; this increment establishes and tests the server contract.
- Cross-process durable store semantics and UI conflict resolution remain
  deployment evidence requirements.
