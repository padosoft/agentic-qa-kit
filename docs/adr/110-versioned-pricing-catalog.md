# ADR-110: versioned pricing catalog identity

- Status: Accepted
- Date: 2026-09-17

## Decision

Introduce `PricingCatalog` with schema version, catalog version, effective UTC
timestamp, model input/output rates and deterministic SHA-256 identity. Parsing
sorts model keys, validates non-negative finite rates, bounded identifiers and
canonical ISO UTC effective timestamps, and rejects a supplied digest mismatch.
`BudgetTracker` accepts either the legacy pricing map or a
catalog (never both), and includes the catalog version/hash in `BudgetState`.

## Consequences

- Usage snapshots can be reconciled against the exact listino used for a gate.
- Legacy callers remain compatible through `defaultPricing`/`pricing`.
- Signature verification, catalog storage/rotation, admin APIs and propagation
  to durable run/cost records remain required for enterprise governance.

## Verification

Cost build/typecheck and tests pass locally with **12 tests and 0 failures**.
