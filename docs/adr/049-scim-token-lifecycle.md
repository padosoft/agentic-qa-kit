# ADR-049 — Dedicated SCIM token lifecycle

## Status

Accepted — 2026-09-17

## Context

SCIM provisioning is machine-to-machine access. A long-lived raw bearer token in a database or an interactive-session verifier creates avoidable blast radius, makes rotation hard, and leaves rejected access attempts invisible.

## Decision

`@aqa/auth` provides `ScimTokenManager` over an injected store. It issues high-entropy opaque tokens, persists only SHA-256 digests, verifies the tenant binding and expiry, compares digests in constant time, and supports revoke/rotate. An injected audit callback receives lifecycle and rejection events without receiving the raw token.

Route hosts remain responsible for connecting `scimAuthorize` to their secret manager/store and for applying rate limits. The manager deliberately does not prescribe a database schema or log token material.

## Consequences

Token compromise can be contained through expiry and rotation, and audit consumers can distinguish invalid, expired, revoked and cross-tenant attempts. Atomic persistence/rotation, secret-manager integration, rate limiting and HTTP admin endpoints remain deployment responsibilities.

## Evidence

Auth typecheck and 14/15 tests pass (one PostgreSQL session test skipped without DSN); the token lifecycle test proves hash-only persistence, tenant rejection, invalid-token rejection, rotation invalidation, expiry and audit sequence.
