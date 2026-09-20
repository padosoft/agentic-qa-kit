# ADR-285: Propagate runner identity into audit and trace provenance

## Status

Accepted

## Context

The control-plane queue already fences leases by runner identity, but a queued
run previously recorded only the generic CLI actor. That made two authorized
workers indistinguishable in the run audit and in OTLP projections.

## Decision

The host-owned `runner_id` is propagated through `makeKitWorker` into
`runRun`, never read from queue payloads. The run-start and run-finished events
record it as the orchestrator actor and a bounded payload field. The trace
observer exposes only the validated identifier as `aqa.runner_id`; no payload
or credential is exported.

## Consequences

- A multi-runner journey can correlate lease owner, audit chain and trace
  spans without trusting tenant-controlled job data.
- Local CLI runs retain the stable `aqa-cli` identity for backwards behavior.
- The field is provenance, not an authorization grant; queue scope and lease
  fencing remain independently enforced.
