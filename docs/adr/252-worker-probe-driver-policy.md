# ADR-252: Propagate probe-driver policy into queue workers

## Status

Accepted — 2026-09-18

## Context

The CLI gained an explicit host-owned driver composition boundary, but a
separate `aqa worker` process initially constructed `RunOptions` without that
boundary. A queued SQL, browser or shell scenario could therefore diverge
from an interactive run's capability and security policy.

## Decision

`RunnerWorkerConfig` parses the same explicit `AQA_PROBE_*` environment policy
as the CLI and passes it through `makeKitWorker` and `makeRunJobHandler` into
`runRun`. Queue payloads cannot select drivers, DSNs, origins or executable
allowlists. Invalid opt-in policy rejects worker startup before it leases jobs.

## Consequences

- Interactive and distributed execution use the same driver boundary.
- Secrets remain process configuration and are not copied into job payloads or
  audit evidence.
- Missing capabilities remain visible, fail-closed execution gaps.
