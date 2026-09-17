# ADR-185: Fail closed on unsupported probe fields and resolve typed oracle references

## Context

Pack fields are untrusted input. Ignoring an unknown HTTP field can make a
scenario appear to test authentication while the request is actually
unauthenticated. Likewise, treating a JSONPath/equality oracle as a plain
string search can pass without comparing the two responses.

## Decision

The HTTP driver rejects unknown fields and supports `auth: "${NAME}"` only
when the host explicitly injects the named secret through the driver options.
The value is converted to an Authorization header in memory and is never
included in pack diagnostics. `response_contains` supports a bounded `$.path`
lookup and equality against a literal or a prior probe reference such as
`@probe-1.body.id`; missing or malformed references fail closed.

## Consequences

Malformed or unconfigured scenarios become execution gaps instead of false
passes. Hosts must provide a secret resolver/configuration for authenticated
packs. Full token-rotation semantics still require a provider-specific login,
rotation and revocation journey; this boundary prevents an unauthenticated
request from claiming that evidence.
