# ADR-086 — Probe driver lifecycle ownership

## Status

Accepted — 2026-09-17

## Decision

Probe runners may expose an optional asynchronous `close()` lifecycle method.
`aqa run` invokes it after scenario execution and before replay/artifact
publication. A close failure is recorded as an operational run error and
cannot be hidden by otherwise successful assertions.

## Rationale

Real browser, database and provider adapters own sockets, contexts, workers or
transactions. Leaving lifecycle ownership to each caller causes resource leaks,
cross-run state contamination and incomplete evidence. The orchestration
boundary must have one deterministic shutdown point.

## Limits

The contract does not force arbitrary third-party runners to implement close;
the host should provide it for any resource-owning driver. A future worker
process boundary must also enforce termination and cancellation if a driver
ignores cooperative close.
