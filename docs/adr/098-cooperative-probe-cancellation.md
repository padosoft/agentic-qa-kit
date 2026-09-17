# ADR-098: cooperative cancellation at the probe boundary

- Status: Accepted
- Date: 2026-09-17

## Context

The queue now stores a tenant-scoped `cancelled` terminal state, but a worker may
already be executing a scenario when the operator cancels its job. Persisting the
state alone cannot interrupt an in-flight HTTP request, browser operation, SQL
query, or subprocess. Treating the job as successfully completed would also make
the execution result and finding output untrustworthy.

## Decision

`ProbeRunner` accepts an optional `AbortSignal`, and `runScenario` forwards the
signal supplied by the future worker/orchestrator. Drivers must map that signal to
their native cancellation mechanism and return an execution error when the
operation is aborted. Execution failures are kept separate from oracle failures,
so an aborted operation cannot create a security finding.

The HTTP driver is the first implementation: it links the external signal to an
internal `AbortController` passed to `fetch`, handles an already-aborted signal
before dispatch, and removes the listener in `finally`.

## Consequences

- Queue cancellation can become a real cooperative abort without changing the
  scenario or oracle data model.
- Provider-specific cancellation remains explicit and testable at each driver
  boundary.
- The current repository does not yet contain a server worker runtime. Until one
  observes the queue state and passes a signal, cancellation remains durable state
  plus an HTTP-driver-ready contract, not process interruption.
- Shell, SQL, PostgreSQL and Playwright drivers must adopt the contract before
  cancellation can be advertised as complete.

## Verification

`bun run --cwd packages/runner build`,
`bun run --cwd packages/runner typecheck`, and `bun test packages/runner/test/run.test.ts`
pass (19 tests). The cancellation test verifies that aborting the external signal
causes the injected fetch to reject.
