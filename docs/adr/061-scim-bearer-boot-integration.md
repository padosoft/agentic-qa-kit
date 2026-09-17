# ADR-061 — SCIM bearer integration in the admin boot path

## Status

Accepted — 2026-09-17

## Decision

The auth package accepts the explicit `Bearer <token-id>.<secret>` transport
form through `ScimTokenManager.verifyBearer()`. `aqa admin` can receive either
an injected `scimAuthorize` callback or a `ScimTokenManager`, never both. Its
HTTP shell delegates `/scim/v2/*` alongside `/api/*` to `makeApi()`.

## Rationale

SCIM provisioning is a security-sensitive integration and must not be a unit-
tested island. The standard transport makes the lifecycle usable without
forcing every host to rewrite bearer parsing, while the callback remains
available for gateway, Vault and enterprise policy integrations.

## Evidence and limits

Boot tests cover unauthorized and authorized SCIM list requests with an opaque
token. Durable token persistence, rotation administration and rate limiting are
still host/deployment responsibilities.
