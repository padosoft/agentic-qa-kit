# ADR-084 — Canonical scenario outcomes

## Status

Accepted — 2026-09-17

## Decision

Every `runScenario()` result exposes a canonical outcome:
`pass`, `fail`, `error`, `blocked` or `not_run`. A valid oracle violation is
`fail`; transport/driver/cleanup failures are `error`; capability preflight
gaps are `blocked`; a completed scenario with all assertions passing is `pass`.
`not_run` remains reserved for orchestration layers that never schedule a
scenario.

## Rationale

One boolean cannot distinguish a broken SUT from a missing provider, a blocked
capability or absent coverage. Release gates, dashboards and ecommerce
reconciliation need to route those states differently and never silently treat
unknown work as green.

## Limits

The outcome is only as trustworthy as the execution and oracle contracts. A
driver must report failures accurately, and the host must provide capability
preflight and independent observers. The kit now persists the outcome in
`scenario_finished` and `run_finished`; the admin/report aggregation still
needs to render this field end-to-end for every scenario.
