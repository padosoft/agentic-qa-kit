# ADR-076 — Sigstore bundle verification with explicit identity policy

## Status

Accepted — 2026-09-17

## Decision

Use the maintained `sigstore` JavaScript client (`5.0.0`, backed by the current `@sigstore/verify` line) for bundle verification. The AQA boundary requires an operator policy containing certificate identity, OIDC issuer and a transparency-log threshold. A manifest declaring `sigstore_bundle` is rejected when that policy is absent or verification fails.

The payload is the declared full-pack content digest when present, otherwise the canonical manifest digest. This keeps the verified bytes explicit and prevents a certificate from being accepted independently of the pack content.

## Rationale

Manual bundle parsing would omit certificate-chain, transparency-log or timestamp semantics and would create a second security implementation. The maintained library provides the actual verification path; AQA adds its application-specific publisher policy and fail-closed import boundary.

## Evidence and limits

- Scanner tests prove policy-required and malformed-bundle rejection.
- Server tests prove a declared bundle cannot enter through the JSON import route without an operator policy.
- A live Fulcio/Rekor keyless signed pack, identity allowlist and revocation/rotation drill remain deployment evidence still required.
