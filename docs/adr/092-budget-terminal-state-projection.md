# ADR-092 — Preserve budget-exceeded run state

## Status

Accepted — 2026-09-17

## Decision

When a `run_finished` payload contains `budget_exceeded: true`, the shared
`Run.deriveStateFromCompletion()` function returns `budget_exceeded`. All
report/admin projections that reconstruct a `Run` must use this function.
Execution, replay and canonical-artifact error counters remain fail-closed
and derive `failed`.

## Rationale

Budget exhaustion is operationally distinct from a product finding or an
unexpected runtime error. Preserving the terminal reason supports accurate
release gates, dashboards and incident handling without treating partial
coverage as success.
