# ADR-037: Explicit SLO and error-budget evaluation

## Status

Accepted

## Decision

`@aqa/observability` exposes `evaluateSlo()` as the canonical pure SLO
calculation boundary. It validates target and event counts, computes allowed
bad events, remaining budget and burn rate, and returns explicit reason/status
pairs. Empty windows are `no_data` and `warning`; exhausted budgets are
`budget_exhausted` and `breached`.

## Consequences

API, dashboards, exporters and release gates can share identical SLO decisions
without duplicating floating-point or missing-data rules. The function does
not claim operational readiness until real counters, alert thresholds and an
OTel/Prometheus deployment feed it.
