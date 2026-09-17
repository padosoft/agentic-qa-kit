# ADR-056 — Separate performance evidence from threshold policy

## Status

Accepted — 2026-09-17

## Decision

k6 and Locust adapters retain normalized numeric measurements on each record.
`evaluatePerformanceThresholds(report, policy)` is the explicit policy
boundary for optional p95, failure-rate and check-rate thresholds. It returns
structured violations and never changes the imported report status.

## Rationale

Tool exit codes and parser status are not a stable service-level policy. Keeping
measurements and policy separate allows the same load-test artifact to be
re-evaluated for different environments, makes failures explainable, and
prevents a missing threshold from being silently interpreted as a pass.

## Evidence and limits

The ingest suite covers passing and violating policies, invalid bounds, and
measurement preservation. CI artifact upload, live load execution and release
gate enforcement remain future integration work.
