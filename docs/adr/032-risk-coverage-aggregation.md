# ADR-032: Derive risk coverage from evidence

## Status

Accepted

## Decision

`@aqa/methodology` exposes `measureRiskCoverage()` as the canonical pure
aggregation boundary. It derives per-risk observations from declared risk and
invariant links, scenario oracle declarations, and timestamped run outcomes.
It computes recent pass rate, deterministic replay coverage, flaky histories,
and stale evidence before delegating to the documented weighted score.

The function does not read a database or guess missing data. API, CLI, admin,
and warehouse integrations must normalize their records into this input and
must not duplicate the scoring formula.

## Consequences

Coverage can be tested and reproduced identically across surfaces, and a
missing or stale run cannot become an accidental green status. A persistence
adapter and API/admin projection are still required before this is an
enterprise dashboard capability.
