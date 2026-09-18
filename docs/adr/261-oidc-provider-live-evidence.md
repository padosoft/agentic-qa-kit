# ADR-261 — Protected live OIDC identity evidence

## Status

Accepted — 2026-09-18

## Context

OIDC contract tests can validate token rules with fixtures while never talking
to the organization's IdP. Enterprise readiness needs a real discovery,
authorization-code, PKCE, JWKS and UserInfo boundary without putting a
reusable credential in Git or silently falling back to local identity.

## Decision

Add a manual workflow bound to `production-identity-evidence`. It requires an
operator-issued, single-use authorization code and PKCE material plus a
client-secret Environment secret. The live test performs discovery, builds the
PKCE authorization URL, exchanges the code, validates the signed ID token and
binds UserInfo to the token subject.

## Consequences

- A successful run proves the configured IdP path at that time and consumes
  one synthetic identity authorization code.
- No secret, code, token or provider response is written to the repository or
  test output.
- SCIM, mTLS, session persistence, rotation, failover and availability remain
  separate evidence obligations.
