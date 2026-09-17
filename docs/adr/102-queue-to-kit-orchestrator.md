# ADR-102: queue jobs invoke the canonical kit orchestrator

- Status: Accepted
- Date: 2026-09-17

## Context

The queue worker previously accepted an injected handler but had no supported
adapter to the actual `aqa run` lifecycle. Implementing a second execution path
would risk divergent artifact, risk-map, budget and audit semantics.

## Decision

`@aqa/kit` exposes `makeRunJobHandler({ root, packsRoot? })`. The handler accepts
only `profile` and `seed` as optional string selectors from the job payload,
binds all filesystem discovery to the fixed deployment configuration, and calls
the canonical `runRun` function with the worker's `AbortSignal`. A non-OK result
becomes a bounded worker failure; findings and ordinary completed runs remain
normal orchestrator outcomes.

`runRun` checks the signal at the scenario scheduler boundary, records remaining
scenarios as `not_run` with reason `cancelled`, and returns `ok: false` rather
than allowing a cancelled run to greenlight a gate.

## Consequences

- Local CLI and queue execution share the same run/audit behavior.
- Tenant payloads cannot select arbitrary roots or pack directories.
- A deployment still needs to compose `RunnerWorker` with this handler and
  provide runner authorization, durable artifact storage and live PostgreSQL
  configuration.

## Verification

`bun run --cwd packages/kit build`, `bun run --cwd packages/kit typecheck`, and
the targeted kit journey suite passes with **3 tests and 0 failures** locally.
