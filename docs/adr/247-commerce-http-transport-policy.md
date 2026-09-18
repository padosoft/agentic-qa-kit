# ADR-247: Enforce HTTPS for external commerce HTTP adapters

## Status

Accepted

## Context

`HttpCommerceAdapter` exercises real merchant APIs. A plaintext external base
URL would allow credentials and commerce mutations to cross an interceptable
transport. Local HTTP remains useful for loopback journeys and emulators.

## Decision

- Require `https:` for the base URL and every configured allowed origin.
- Permit `http:` only for `localhost`, `127.0.0.1` or `::1`, and only when
  `allowInsecureLocalHttp: true` is set explicitly.
- Reject credentials embedded in base URLs or allowed origins.
- Keep redirect mode manual; the adapter does not widen the origin policy after
  a redirect.

## Consequences

Production integrations fail closed on accidental plaintext endpoints while
local HTTP journeys remain available through an explicit opt-in. This is
transport-policy evidence, not proof of a merchant's TLS configuration,
certificate lifecycle or network egress controls.
