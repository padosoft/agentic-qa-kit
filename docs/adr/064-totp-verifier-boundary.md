# ADR-064 — RFC 6238 TOTP verifier boundary

## Status

Accepted — 2026-09-17

## Decision

`@aqa/auth` exposes a pure `verifyTotp` function for RFC 6238 shared-secret
verification. It accepts Base32 secrets, validates bounded period/digits/skew
options, rejects malformed codes, handles the initial negative-counter window
without throwing, and compares candidate codes with a constant-time operation.
The implementation uses SHA-1 as required by the RFC default profile and does
not log or persist the secret.

## Rationale

This gives OIDC/SAML and future local-auth flows a tested cryptographic
verification primitive while keeping security-sensitive lifecycle concerns
separate. Enrollment, secret generation, Vault/KMS persistence, per-user
replay/rate limiting, recovery codes, device management and WebAuthn require
different threat models and operational contracts; combining them here would
make the current API appear more complete than it is.

## Evidence and limits

The auth suite covers RFC 6238-compatible vectors, wrong-code rejection and a
bounded clock-skew window: **18 passed, 3 PostgreSQL-dependent skips, 0
failures** locally. Enrollment, durable secret storage, recovery codes,
WebAuthn and production IdP/local-login journeys remain open roadmap items.
