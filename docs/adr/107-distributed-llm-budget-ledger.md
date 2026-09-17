# ADR-107: distributed LLM budget reservations

- Status: Accepted
- Date: 2026-09-17

## Decision

Add a `BudgetLedger` boundary with `reserve(key, budget, estimate)` and
idempotent `settle(reservation, actual)`. `MemoryBudgetLedger` supports local
execution. `PostgresBudgetLedger` stores budget rows and reservations, locks the
budget row during admission, rejects when spent plus reserved plus the new
estimate reaches the limit, and settles each reservation once. Its migration is
advisory-locked, and an existing key rejects a changed budget configuration
instead of silently adopting it.

`BudgetedLlmAdapter` uses the ledger optionally in addition to its local
`BudgetTracker`: reserve before provider dispatch, release on provider failure,
settle actual usage after success.

## Consequences

- Concurrent workers cannot oversubscribe a configured budget based only on local
  snapshots.
- Provider usage remains authoritative while in-flight estimates provide the
  admission guard.
- This does not yet provide an admin budget configuration API, pricing catalog
  replication, stale-reservation expiry/reaper, or external provider invoice
  reconciliation.

## Verification

Cost build/tests pass with **9 tests and 0 failures**; LLM adapter build/tests
pass with **16 tests and 0 failures** locally. PostgreSQL live evidence requires
`AQA_TEST_POSTGRES_DSN`.
