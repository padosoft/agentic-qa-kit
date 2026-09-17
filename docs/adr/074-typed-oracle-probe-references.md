# ADR-074 — Typed oracle-to-probe references

## Status

Accepted — 2026-09-17

## Decision

Scenarios may declare `oracle.probe_id`. The schema validates unique step IDs and verifies each reference exists in `steps`; the runner selects only that probe result for evaluation and returns a failed oracle when the result is absent. Scenarios without `probe_id` retain their legacy compatibility behavior while packs migrate.

## Rationale

An oracle is evidence about a specific observation, not an aggregate over arbitrary actions. Explicit references prevent wrong-step matches and make replay, audit and human review explainable.

## Evidence and limits

- Schema tests cover valid references, duplicate steps and missing references.
- Runner tests cover targeted status evaluation and missing-reference fail-closed behavior. Existing packs still need migration to remove legacy fallback semantics.
