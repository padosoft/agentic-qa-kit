# ADR-040: Fail-closed cost dispatch boundary

## Status

Accepted — policy boundary shipped; runtime wiring remains open.

## Decision

`BudgetTracker.assertCanDispatch()` is the pre-provider admission boundary. It
rejects unknown pricing, calls that would reach the configured budget, and an
explicitly halted tracker. `halt(reason)` is irreversible for that tracker
instance and records a bounded operator reason without secrets. Existing
`charge()` remains a reconciliation operation and still records actual usage.

## Consequences

Callers can prevent a known over-budget provider call and implement an explicit
emergency stop. This is not yet a distributed organization-level kill switch:
the worker must invoke admission before every provider call, persist/replicate
halt state, reconcile provider usage, and emit an auditable `budget_exceeded`
event. Until that wiring is proven, cost governance is only partially complete.
