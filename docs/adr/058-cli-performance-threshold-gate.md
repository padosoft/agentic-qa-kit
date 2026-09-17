# ADR-058 — CLI performance threshold gate and evidence preservation

## Status

Accepted — 2026-09-17

## Decision

`aqa ingest k6|locust <file> --threshold-file <policy.json>` parses and stores
the performance report, then evaluates the explicit numeric policy. The report
and threshold result are separate redacted artifacts. A policy violation exits
with code `2`; malformed input or policy exits with code `1`.

## Rationale

CI needs a deterministic gate, but a failed gate must not discard the artifact
needed to diagnose it. Distinct exit semantics let automation distinguish bad
input from a measured regression.

## Evidence and limits

Kit tests cover both adapters and a failed p95 policy with persisted threshold
evidence. CI workflow integration, live load generation and release promotion
rules remain deployment work.
