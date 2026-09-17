# ADR-131: Replay artifact fidelity

**Status:** Accepted  
**Date:** 2026-09-17

## Context

The reporter emitted Playwright and SQL files for every matching probe, but
the files could be comment-only. Their presence made a finding look replayable
even when no action or query could execute, weakening the reproducibility
claim.

## Decision

Generate Playwright code from the runner's structured `url` and action contract
(`goto`, `click`, `fill`, `press`, `wait_for`). Generate SQL as a read-only
transaction with a prepared statement and SQL-literal rendering of the probe
parameters. A Playwright probe that delegates to an external script is emitted
as an explicit skipped test with the source path and arguments; it is not
silently converted into a fake reproduction.

## Consequences

- Structured probes have a useful local replay artifact whose semantics match
  the runner.
- SQL replay requires the original read-only database target and may fail for
  provider-specific SQL, which remains visible at execution time.
- External script replay still needs the original test harness; future work may
  package a signed, dependency-locked replay capsule around it.
