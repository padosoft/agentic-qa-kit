# ADR-090 — Profile wall-clock budget enforcement

## Status

Accepted — 2026-09-17

## Decision

The orchestrator treats `profile.budget_minutes` as a wall-clock scheduling
deadline. Before each scenario starts, it checks the deadline. If exhausted,
the scenario receives a `scenario_finished` event with `outcome: not_run` and
`reason: budget_exceeded`; the run records `budget_exceeded: true` and fails
closed. The budget clock is injectable for deterministic tests and defaults to
`Date.now`.

## Rationale

A profile field that is parsed but ignored is a governance defect: a release
gate can silently run only a prefix of its intended coverage. Explicit
non-execution evidence and a non-zero failure state preserve audit honesty.

## Limits

This does not interrupt a request already executing. HTTP, SQL, shell and
browser drivers must continue to enforce their own timeouts; provider-specific
cancellation and LLM token/dollar budgets remain follow-up controls.
