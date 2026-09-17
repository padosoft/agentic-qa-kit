# ADR-073 — Shared browser/backend audit-chain verification

## Status

Accepted — 2026-09-17

## Decision

The audit canonicalization algorithm lives in a runtime-neutral module. `@aqa/compliance` remains the Node verifier and exposes `@aqa/compliance/browser` as a WebCrypto-only verifier for the admin bundle. The browser viewer validates the raw API records, not the filtered display projection, and can validate a prefix during progress animation.

## Rationale

The admin UI previously carried a parallel implementation of canonical JSON and SHA-256 verification. That made a UI “CHAIN OK” a weaker claim than the CLI verifier if either implementation drifted. Sharing canonicalization and testing both entrypoints against the same tampering cases makes the consumer boundary explicit.

## Evidence and limits

- `packages/compliance/test/compliance.test.ts` proves Node/browser agreement and rejects reordered and altered records.
- `packages/admin` production build passes and imports the browser subpath. Browser E2E still needs a configured authenticated live server journey; hash verification does not prove WORM immutability, completeness or external checkpoint authenticity.
