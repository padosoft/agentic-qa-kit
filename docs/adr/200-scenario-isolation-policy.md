# ADR-200: Scenario isolation policy

## Status

Accepted

## Context

Bounded parallelism improves throughput, but scenarios that touch the same
cart, tenant, database fixture or other mutable SUT state can contaminate one
another. A worker limit alone does not provide an isolation guarantee.

## Decision

Profiles declare `isolation` with one of three values:

- `parallel`: preserve the configured worker pool; no scheduler serialization;
- `grouped`: scenarios with the same `isolation_group` run one at a time;
- `serial`: all scenarios run one at a time, regardless of `parallelism`.

The scheduler acquires the group lock before emitting `scenario_started` and
releases it after the scenario has completed. The selected policy and group
key are included in the start event. A missing group in `grouped` mode uses the
scenario ID, so unrelated scenarios remain eligible for parallel execution.

This is a scheduling guarantee only. It is not a substitute for container/VM
isolation, tenant reset, database transactions or provider-side idempotency.
Those remain explicit deployment and adapter contracts.

## Consequences

Pack authors can declare shared-state boundaries without forcing every run to
be serial. Release profiles that cannot safely share state can select
`isolation: serial`; profiles with independent state can retain throughput.
The policy is backwards-compatible because the default is `parallel`.
