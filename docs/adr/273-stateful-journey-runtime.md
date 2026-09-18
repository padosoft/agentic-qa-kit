# 273 — Runtime execution for actor-bound stateful journeys

- **Status:** accepted
- **Date:** 2026-09-19
- **Deciders:** maintainers
- **Tags:** methodology, runtime, stateful-qa, security

## Context

ADR-268 validated state topology but intentionally did not execute actions.
That left a material v2.2 gap: a legal path could still be a false assurance
if the wrong actor performed a transition, the application reached a different
state, or cleanup was skipped after a failure.

## Decision

Add `compileStatefulJourney` and `executeStatefulJourney` to
`@aqa/methodology`. Compilation validates the graph/path, requires every
transition actor to have a unique bounded actor binding, requires a terminal
state by default, and produces a deterministic plan digest. Execution invokes
injected actor-scoped actions, requires an authoritative observed target state,
runs transition-bound temporal observers, propagates cancellation and a
bounded wall-clock signal, and always invokes the injected cleanup callback.
Only bounded codes and metadata are returned; actor contexts and provider
exception text are never serialized into the result.

## Consequences

### Positive

- Stateful journey execution is now a real runtime contract, not only static
  graph validation.
- Actor isolation, state observation, temporal checks and cleanup are explicit
  and testable.
- Stable digests support evidence correlation without retaining secrets.

### Negative / trade-offs

- The methodology package cannot force a non-cooperative provider callback to
  stop; deployment runners must isolate such adapters in a cancellable sandbox.
- The action callback must supply the authoritative observed state, so adapters
  need an application-specific state read-back.

### Neutral / follow-ups

- Integrate compiled plans with the CLI/worker run lifecycle and trace
  correlation in a later sub-task.
- Add provider-specific actor/session adapters only behind explicit host policy.

## Alternatives considered

- **Treat graph evaluation as execution:** rejected because it creates false
  confidence without side effects or read-back.
- **Let callbacks return arbitrary errors/evidence:** rejected because it can
  leak provider secrets into audit artifacts.

## References

- ADR-268 — Bounded stateful journey graph contract
- `packages/methodology/src/stateful-journey.ts`
- `packages/methodology/test/stateful-journey.test.ts`
