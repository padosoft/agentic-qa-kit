# ADR-198: Bounded scenario parallelism

## Status

Accepted

## Context

Profiles already exposed `parallelism`, but the run loop awaited every
scenario serially. This silently invalidated capacity settings and encouraged
operators to assume isolation that did not exist.

## Decision

`aqa run` first resolves and validates the complete scenario set, then executes
it through a worker pool whose size is `min(profile.parallelism, scenario_count)`.
The scheduler reserves each discovery position synchronously before awaiting a
probe, preserving unique finding seeds and bounded concurrency. The final
scenario summary is sorted by discovery position. Audit events retain their
actual completion order and include `dispatch_order` on scenario-start events.

## Consequences

Parallel runs improve throughput and make the configured profile meaningful,
but event timestamps/order are intentionally completion-based. Operators must
use scenario isolation (transaction, schema, or container) when scenarios can
mutate shared state; parallelism alone is not an isolation guarantee. Seeded
replay remains deterministic at the scenario-summary level, while event timing
and interleaving are not promised to be byte-identical.
