# ADR-099: cooperative queue worker runtime

- Status: Accepted
- Date: 2026-09-17

## Context

The queue persisted leases and cancellation, and the runner accepted an
`AbortSignal`, but no reusable worker runtime connected those boundaries. A
future worker must not ACK a cancelled job, must fence stale leases, and must
avoid persisting an unbounded provider error.

## Decision

Add `RunnerWorker` to the server package with an injected `RunnerJobHandler`.
For each leased job it:

1. creates an `AbortController`;
2. polls `queue.get(id)` at a bounded interval;
3. aborts the handler when the durable job becomes `cancelled`;
4. ACKs only when the handler completes and the job is still live;
5. records a bounded, single-line failure through `queue.fail` otherwise.

`RunnerQueueLike.get` returns the current immutable job snapshot. The worker
normalizes sync memory responses and async PostgreSQL responses with
`Promise.resolve`.

## Consequences

- Queue cancellation now has a real reusable process-side observation loop.
- The server package remains provider-neutral; scenario loading and driver
  selection are injected instead of being duplicated in the control plane.
- This is cooperative cancellation, not OS-level process killing. A driver must
  consume the signal, and long jobs need lease renewal before production use.
- The current handler contract does not yet publish run artifacts or map the API
  payload to the CLI's full `aqa run` orchestration. Those are separate slices.

## Verification

`bun run --cwd packages/server build` and `bun test --cwd packages/server` pass
with **120 tests and 0 failures** in the local environment. PostgreSQL live
tests remain skipped without `AQA_TEST_POSTGRES_DSN`.
