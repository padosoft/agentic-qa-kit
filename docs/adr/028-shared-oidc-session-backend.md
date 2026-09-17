# ADR-028 — Shared OIDC session backend

## Status

Accepted — 2026-09-17

## Context

The original admin OIDC flow kept PKCE state and authenticated sessions in
process-local maps. Behind a load balancer, the callback or a later API call
could land on another replica and fail; a restart also logged every user out.

## Decision

`OidcSessionManager` accepts an asynchronous `OidcSessionStore`. The shared
contract atomically consumes PKCE state exactly once and persists short-lived
session records. `PostgresOidcSessionStore` creates dedicated tables under an
advisory-locked migration, uses `DELETE ... RETURNING` for one-time state and
never exposes the verifier or token in logs. Admin authentication and logout
use the async methods; the old synchronous method fails closed whenever a
shared backend is configured. The local map remains the explicit development
default.

## Consequences

Multiple manager instances can complete and authenticate the same flow when
they share the backend. Production operators still need TLS, cookie policy,
database encryption/retention, session TTL policy and an injected
`PostgresOidcSessionStore`; no secret or DSN is printed by the library.
