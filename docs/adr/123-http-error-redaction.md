# ADR-123: shared HTTP error redaction boundary

## Status

Accepted

## Context

Provider, database and identity errors can contain connection strings, bearer
tokens, API keys, payment-card numbers or multiline diagnostic data. Returning
`Error.message` from an HTTP adapter turns an operational failure into an
information-disclosure vulnerability.

## Decision

Expose `safeErrorMessage()` from `@aqa/observability` and use it at the server
and bundled admin HTTP boundaries. It removes common credential-bearing DSNs,
authorization tokens, JWTs, cloud keys, PAN/IBAN values and secret-valued
assignments, normalizes control characters, and caps the result at 500
characters. The fallback is generic when the exception has no usable message.

## Consequences

User-facing validation errors can remain actionable after redaction, while
diagnostic detail belongs in access-controlled structured logs. This is a
defense-in-depth filter, not a replacement for centralized artifact DLP,
provider-specific redactors, secret rotation or a policy forbidding sensitive
data in exception messages.
