# ADR-093 — Resolve risk references before scenario execution

## Status

Accepted — 2026-09-17

## Decision

`aqa run` parses the project's `.aqa/risk-map.yaml` and the validated risk-map
files listed by each selected pack. Scenario `risk_refs` must resolve against
that combined catalog before the scenario is scheduled. The resolved primary
risk is passed to the runner, which uses its ID and severity when creating a
finding. Missing references are coverage errors and cannot produce a green run.

## Rationale

Risk IDs are part of the evidence chain. A hard-coded finding severity hides
the actual risk model, and an unresolved reference makes coverage appear more
complete than it is.

## Limits

The current finding model chooses the first declared risk as the primary risk.
Multi-risk aggregation, severity policy overrides and project-level approval
of pack risk catalogs remain follow-up controls.
