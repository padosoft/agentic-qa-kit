# ADR-248: Pin OIDC discovery endpoints to trusted HTTPS origins

## Status

Accepted

## Context

OIDC discovery is provider-controlled metadata. Validating only the discovered
issuer is insufficient: a compromised or misconfigured document could point
token, UserInfo or JWKS requests at an unrelated origin, creating SSRF,
credential-routing and key-substitution risk.

## Decision

- Require the configured issuer to be HTTPS and free of URL credentials.
- Trust the issuer origin by default for authorization, token, UserInfo and JWKS
  endpoints.
- Permit additional HTTPS origins only through
  `allowed_endpoint_origins`.
- Reject endpoint credentials, plaintext HTTP and origins not in that allowlist.

## Consequences

Common IdPs remain zero-config when all endpoints share the issuer origin.
Providers that intentionally split origins require an explicit deployment
configuration. Discovery remains provider-backed evidence, but this policy
does not replace certificate, DNS, egress or IdP lifecycle controls.
