# ADR-254: Operator-owned OIDC runtime wiring

## Status

Accepted — 2026-09-18

## Context

The kit already provided a provider-neutral `OidcAdapter`, an
`OidcSessionManager` and a PostgreSQL-backed shared session store. The Helm
chart projected `AQA_OIDC_SESSION_DSN`, but `aqa admin` did not construct the
OIDC boundary from its deployment environment. A pod could therefore contain
OIDC/session settings while still using the local development identity.

## Decision

When no programmatic OIDC manager is supplied, `aqa admin` resolves an
explicit `AQA_OIDC_*` configuration from the operator environment. Required
issuer, client, redirect and secret settings are validated before boot;
partial configuration fails closed. `AQA_OIDC_SESSION_DSN` creates
`PostgresOidcSessionStore` so PKCE state and sessions are shared across
replicas. An explicitly injected manager remains the host-owned override.

The Helm chart enables this path only with `auth.oidc.enabled=true`, requires
all public settings, a Secret-backed client secret and a PostgreSQL source, and
never places the secret in ordinary values or logs.

## Consequences

- A production OIDC deployment cannot silently fall back to local admin auth.
- Multiple server replicas share one-time login state and revocable sessions.
- Local development remains unchanged when OIDC is absent.
- Provider discovery, real IdP issuance, TLS termination and rotation remain
  deployment evidence; this change closes the previously missing runtime
  composition boundary.
