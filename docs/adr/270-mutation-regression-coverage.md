# ADR-270: Mutation-to-regression coverage contract

## Status

Accepted

## Context

A mutation score says how many mutants were killed, but not which risk or
regression scenario provides that protection. A high aggregate score can hide
an untested critical control, and an unreviewed mapping can fabricate coverage.

## Decision

Add a versioned reviewed manifest mapping each mutation ID to bounded risk and
scenario IDs. `aqa mutation coverage <report> <manifest>
--min-mapped-rate X --min-killed-rate X` validates the external report,
requires known unique links, reports unmapped IDs and emits per-risk kill
rates. Ignored mutants remain outside the evaluated denominator according to
the mutation report contract.

Mutation execution remains external and must bind commit, tool configuration,
test command and evidence checkpoint before this gate can be a release claim.

## Consequences

The roadmap can express mutation-to-regression coverage instead of only a
single score. It still cannot prove that the producer ran the intended source
revision or that the human manifest is complete; protected execution and
independent review remain required.
