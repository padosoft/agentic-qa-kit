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
migration, while clients progressively adopt conditional writes. The admin
profile, risk and scenario editors capture the ETag at open time and send it
on their update request; after a successful update they retain the new
response ETag.

## Consequences

- API clients can implement safe optimistic concurrency without relying on
  client clocks or in-memory versions.
- A stale admin edit surfaces an inline conflict and offers an explicit reload
  of the authoritative resource plus its replacement ETag. The current
  policy intentionally discards unsaved local edits on reload; field-level
  merge remains a future workflow for large YAML resources.
- Cross-process durable store semantics and UI conflict resolution remain
  deployment evidence requirements.
