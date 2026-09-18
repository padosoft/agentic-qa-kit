# ADR-257 — Bounded HTTP gift-card provider adapter

## Status

Accepted — 2026-09-18

## Context

The provider reconciliation contract is useful only if a live issuer can be
connected without weakening transport or evidence boundaries. A generic HTTP
client that follows redirects, accepts URL credentials or reads unbounded
responses could turn a QA probe into credential leakage or SSRF.

## Decision

Provide `HttpGiftCardProvider` with an explicit HTTPS base URL, origin
allowlist, manual redirects, bounded response bytes and an injected header
function for deployment-managed authentication. Loopback HTTP is available
only when explicitly enabled for local test journeys. The adapter parses the
same `GiftCardProviderSnapshot` used by the reconciliation journey and does
not log response payloads or credentials.

## Consequences

- A real issuer integration has one typed, fail-closed transport boundary.
- Unit tests can inject `fetch` without secrets or network access.
- Provider IAM, token rotation, issuer semantics and production execution
  remain deployment evidence and are not inferred from the adapter tests.

## Evidence

`packages/commerce/test/gift-card-http-provider.test.ts` covers tenant-bound
requests, path encoding, credential rejection, HTTPS enforcement, explicit
loopback mode, redirect rejection, response limits and schema validation.
