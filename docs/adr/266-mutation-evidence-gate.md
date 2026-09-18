# ADR-266: External mutation evidence gate

## Status

Accepted

## Context

The methodology roadmap needs mutation evidence, but the kit must not silently
run arbitrary project test commands or mutation tools with production
credentials. Stryker and mutmut also emit different report shapes and status
spellings.

## Decision

`@aqa/ingest` normalizes bounded flat and Stryker-style JSON reports into a
versioned in-memory contract. It accepts explicit mutant statuses, rejects
unknown/duplicate records, excludes only `ignored` from the denominator, and
calculates a deterministic mutation score. `aqa mutation gate <report>
--min-score X` applies the release threshold and exits non-zero on failure.

Mutation tool execution remains an external, operator-owned CI concern. A
future protected workflow must bind the report to the commit, test command,
tool version and artifact checkpoint before treating this gate as production
evidence.

## Consequences

The boundary is safe to run in untrusted repositories and makes mutation
coverage auditable. It intentionally does not claim that a report is genuine,
that mutation execution reached every intended source file, or that a score is
an adequate substitute for risk-based testing.
