# ADR-122: explicit admin CORS and mutation origin policy

## Status

Accepted

## Context

The bundled admin server exposed `Access-Control-Allow-Origin: *` while also
serving authenticated endpoints. That is an unsafe control-plane default and
makes future credentialed browser changes easy to introduce incorrectly.

## Decision

`aqa admin` has no cross-origin access by default. Operators may provide an
explicit `corsOrigins` allowlist. Allowed origins receive the exact origin,
credentials permission, `Vary: Origin` and a bounded method/header list.
Disallowed preflight requests return `403`; disallowed cross-origin state-
changing requests are rejected before route handling. Same-origin requests are
unchanged.

## Consequences

Browser integrations must configure exact origins, including scheme and port.
This is a browser boundary, not a replacement for authentication, tenant
authorization, CSRF tokens, SameSite cookies or network controls.
