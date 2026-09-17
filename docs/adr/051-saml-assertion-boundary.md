# ADR-051 — SAML assertion validation boundary

## Status

Accepted — 2026-09-17

## Context

SAML XML signature verification and parsing are security-sensitive and provider-specific. AQA still needs a deterministic identity boundary that does not accept a validly signed assertion for the wrong service provider, an expired assertion, or a replayed assertion.

## Decision

`@aqa/auth` exposes `SamlLoginBoundary` over an injected signature/parser adapter and an atomic replay guard. After the adapter verifies the XML signature, the boundary enforces exact issuer and audience, required subject/email, time window, optional `NotBefore`, one-time assertion claim, and least-privilege role mapping. Unsupported roles are ignored; an assertion with no supported role defaults to `viewer`.

The project does not ship a hand-written XML signature verifier. Production integrations must use a maintained SAML library, pin IdP metadata/certificates, validate canonicalization and key rollover policy, then pass only verified claims to this boundary.

## Evidence

Auth typecheck and 16/17 tests pass (one PostgreSQL session skip); issuer, audience, expiry, malformed claims and replay rejection are covered.
