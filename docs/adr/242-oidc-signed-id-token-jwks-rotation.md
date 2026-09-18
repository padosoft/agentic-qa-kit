# ADR-242 — OIDC signed ID-token validation and JWKS rotation

## Decision

The OIDC authorization-code boundary must require an ID token and a nonce
bound to the one-time AQA login state. The adapter validates only `RS256`,
requires a `kid`, and verifies the signature against the provider's discovered
JWKS. It also checks the discovery issuer, `iss`, `aud`, `azp` for multi-audience
tokens, `iat`, `exp`, and the UserInfo `sub` binding. A short in-memory JWKS
cache is refreshed once when a previously unseen key ID appears, which supports
provider key rotation without trusting an arbitrary key.

## Boundary

This closes token-validation and key-rotation gaps in the AQA application
boundary. It does not claim a live IdP ceremony, IdP availability/SLO,
registration, SCIM provisioning or browser MFA evidence. Those remain separate
provider-backed journeys.

## Compatibility

PostgreSQL pending-login state gains a nullable `nonce` column through an
idempotent migration. Existing pending rows without a nonce are intentionally
not consumable; new rows always contain a nonce. This fails closed during a
rolling upgrade rather than weakening OIDC replay protection.
