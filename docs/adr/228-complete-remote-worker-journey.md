# ADR-228 — Complete remote worker run journey

- Status: accepted
- Date: 2026-09-18

## Context

The remote queue identity contract was proven with a synthetic job handler,
while the PostgreSQL journey used an in-process worker. Neither alone proved
that an authenticated, separate control-plane boundary could execute the real
Kit lifecycle and publish canonical run evidence.

## Decision

Add a complete HTTP journey using `runAdmin`, `HttpRunnerQueue`, the real
`makeKitWorker`, a generated schema-valid project/pack, and a local HTTP SUT.
The control queue is only reachable through authenticated runner routes. The
journey asserts scoped dequeue, the real probe/run path, persisted events and
findings, completion ACK, and a token source that returns a new signed JWT
after the first request.

## Consequences

This proves the application boundary and artifact lifecycle across processes
without claiming PostgreSQL, Kubernetes networking, TLS/mTLS termination or
remote S3 publication in the same test. Those infrastructure combinations
remain separate CI/deployment evidence and must not be inferred from this
journey alone.
