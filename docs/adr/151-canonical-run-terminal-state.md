# ADR-151: Persist one canonical run terminal state

## Status

Accepted

## Context

The runner, report command and admin seeding path all reconstructed run state
from completion counters. That preserved compatibility, but any new policy
reason or consumer-specific interpretation could make the same run appear
successful in one surface and failed in another.

## Decision

The orchestrator writes `run_finished.payload.run_state` with the terminal
`RunState` selected by the shared schema policy. Because the completion event is
hash chained, consumers can trust the value after chain verification. The
shared `deriveStateFromCompletion` helper prefers this explicit terminal value
for new events and falls back to the historical counter rules for legacy audit
files that do not contain it.

## Consequences

- CLI, report and admin projections converge on the same persisted decision.
- Legacy runs remain readable without a migration.
- A future policy change requires a schema/event compatibility decision rather
  than silently changing historical reports.
- Canonical artifact publication errors remain a separate finalization gap; the
  event state cannot claim successful publication before the artifact operation
  executes.
