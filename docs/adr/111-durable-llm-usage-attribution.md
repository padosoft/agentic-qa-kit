# ADR-111: durable LLM usage attribution

- Status: Accepted
- Date: 2026-09-17

## Decision

Settled budget reservations carry the provider model, authoritative input/output
token counts, actual USD and optional pricing catalog version/hash. The Memory
ledger retains this metadata for parity; the PostgreSQL ledger adds nullable
columns through an additive migration so historical and expired rows remain
valid. `BudgetedLlmAdapter` supplies the metadata only after the provider call
returns successfully.

## Consequences

- Cost reconciliation can identify which model and price catalog produced a
  charge, rather than relying on aggregate totals alone.
- Existing reservations and orphan reaping remain compatible. Reaping releases
  the estimate but intentionally does not create a fabricated provider-usage
  record.
- A read API/report and live PostgreSQL multi-client migration test are still
  required before production financial sign-off.

## Verification

Cost build/typecheck and **12 tests** pass; LLM adapter build and **17 tests**
pass locally.
