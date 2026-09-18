# ADR-253: Helm policy for worker probe drivers

## Status

Accepted — 2026-09-18

## Context

The queue worker can now execute explicit SQL/PostgreSQL, Playwright and shell
drivers, but a Helm deployment had no durable way to provision that same
operator policy. Putting DSNs or executable policy in queue payloads would
break the worker trust boundary; silently enabling them in the chart would
break least privilege.

## Decision

Expose `runner.worker.probeDrivers` in chart values, disabled by default.
PostgreSQL receives its DSN only from a referenced Kubernetes Secret.
Playwright requires a non-empty origin allowlist, and shell requires a
non-empty executable allowlist. The template renders only enabled driver
environment variables. Validation fails at Helm render time for incomplete
policies, before a worker pod can lease jobs.

The chart does not infer network identity from a DSN Secret. Managed database
or SUT egress remains an explicit `runnerExtraEgressCidrs` operator decision.

## Consequences

- Interactive and Helm-managed workers can use the same driver policy.
- Secrets stay in Kubernetes Secret references and never enter values rendered
  as ordinary strings or queue payloads.
- Enabling shell/browser/SQL remains a visible deployment decision with a
  render-time guardrail.
- Production operators still need provider-specific network, browser image,
  database role and evidence configuration.
