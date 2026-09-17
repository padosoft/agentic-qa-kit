# ADR-157 — Durable distributed LLM budget kill-switch

## Status

Accepted — 2026-09-17

## Context

`BudgetTracker.halt()` protects only one process. In a multi-worker deployment,
another adapter could continue reserving and dispatching LLM work after an
operator emergency stop. A local boolean is therefore not a production
control boundary.

## Decision

The optional `BudgetHaltController` exposes an irreversible per-key `halt()`
and `getHaltReason()` without breaking existing third-party
`BudgetLedger` implementations. `MemoryBudgetLedger` keeps the explicit local
fallback.
`PostgresBudgetLedger` persists halts in `aqa_llm_budget_halts`; every future
reservation checks the shared table before changing budget state. Reasons are
bounded and never include provider credentials or request payloads.

The halt is intentionally append/update-only for this control surface: reset
requires a new budget key or an explicit operator database procedure. This
prevents an accidental retry from silently clearing an emergency stop.

## Evidence and limits

The memory contract has a regression for persistence across future admissions;
package typecheck and tests pass. The PostgreSQL schema and live multi-client
halt/dispatch journey remain CI/deployment evidence and must be exercised with
`AQA_TEST_POSTGRES_DSN` before claiming HA operational readiness.
