# ADR-105: SQL cooperative cancellation boundary

- Status: Accepted
- Date: 2026-09-17

## Decision

The generic SQL probe adapter receives the worker `AbortSignal`, rejects before
dispatch when already aborted, and checks it after the injected query resolves.
An aborted query is returned as execution error and cannot feed an oracle.

The PostgreSQL adapter passes the signal through its boundary and retains its
read-only transaction plus bounded `statement_timeout`. Because the selected
client API does not expose a verified native cancellation primitive here, the
implementation makes no claim that the server-side query is interrupted at the
instant of abort.

## Consequences

- Host adapters can implement native cancellation without changing the runner
  contract.
- PostgreSQL remains bounded and read-only even when cooperative cancellation is
  requested.
- Native `pg_cancel_backend`/client cancellation, live PostgreSQL evidence and
  query-resource cleanup remain deployment-specific follow-up work.

## Verification

Runner build/typecheck and the runner suite pass locally with **22 tests and 0
failures**.
