# ADR-215: Ship an opt-in performance SLO pack

## Status

Accepted — 2026-09-18

## Decision

Ship `pack-performance` with contracts for p95/p99 latency, error-budget
release gating and saturation visibility.

## Boundary

The pack does not generate load itself and does not guarantee production
capacity. Load-runner output, infrastructure metrics, cost controls and SLO
ownership must be supplied by the operator.
