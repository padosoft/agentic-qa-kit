# ADR-268: Bounded stateful journey graph contract

## Status

Accepted

## Context

Stateful QA needs more than a list of probes: a payment, entitlement or
session journey has declared states, actors and legal transitions. Without a
graph boundary, a generated journey can skip a state, reference a missing
transition or silently stop in a non-terminal dead end.

## Decision

`@aqa/methodology` now validates a bounded versioned state graph and evaluates
a declared transition path. IDs, endpoints, reachability, terminal states,
duplicate transitions and path size are checked before a compiler or runner
may consume the graph. Actions are descriptive metadata only; this module does
not perform HTTP, browser, database or provider side effects.

## Consequences

Journey generation can be validated independently of the system under test,
and illegal paths become explicit violations instead of false passes. The
graph is not runtime evidence: a production journey still needs real actor
session isolation, authoritative observers, temporal assertions, cleanup and
artifact provenance.
