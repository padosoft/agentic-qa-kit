# ADR-132: Route-derived OpenAPI contract

**Status:** Accepted  
**Date:** 2026-09-17

## Context

The HTTP API is assembled from a concrete route table, while documentation and
client tooling had no authoritative machine-readable contract. A separately
maintained OpenAPI file would eventually drift from authentication, permissions,
methods, or path parameters actually served by the admin process.

## Decision

Generate an OpenAPI 3.1 document from the same route table used by the server.
Expose it from `GET /openapi.json` and include operation IDs, bearer security,
route permission metadata, path parameters, and versioned domain schema
references. Domain schemas remain owned by `@aqa/schemas`; transport envelopes
are generated around those references.

Add a route-count test and an HTTP smoke assertion so every concrete route has a
published operation and the running admin process serves the generated document.

## Consequences

- New routes automatically appear in the contract and route drift becomes a
  test failure instead of silent documentation debt.
- Consumers can discover the API without depending on private source files.
- A few specialized endpoints still expose intentionally generic response
  envelopes until their domain response types are promoted into the schemas
  package; those endpoints are visible rather than silently undocumented.
- Evidence: server API tests (124) and kit tests (140, including two expected
  platform symlink skips), repository typecheck, Biome lint, and diff checks
  passed locally. Live reverse-proxy/OpenAPI consumer compatibility remains an
  external deployment check.
