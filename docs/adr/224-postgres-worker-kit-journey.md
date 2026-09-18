# ADR-224: Complete PostgreSQL queue-to-kit worker journey

## Status

Accepted

## Context

The memory queue journey proved that `RunnerWorker` can compose with the kit
handler, but that evidence did not exercise the durable queue, migration,
lease/ACK path and run artifacts together. Treating the in-memory journey as
proof of the production fleet would hide database-specific serialization or
connection failures.

## Decision

The PostgreSQL CI job runs the kit's complete worker journey when
`AQA_TEST_POSTGRES_DSN` is configured. The test enqueues a real job through
`PostgresRunnerQueue`, runs it through `makeKitWorker` and the canonical
`runRun` HTTP probe path, asserts the durable job reaches `done`, and verifies
that `events.jsonl` and `findings.jsonl` are emitted in the operator-owned
project root.

The job identity and project scope are unique per test invocation. The worker
must use that scope, so unrelated queued work in the shared CI database cannot
be accidentally claimed by this journey. The test remains an explicit
environment skip outside a PostgreSQL integration environment; a local skip is
not production evidence.

## Evidence boundary

This proves queue-to-kit orchestration against PostgreSQL 16 in CI. It does not
prove a deployed multi-process worker fleet, external artifact storage,
runner JWT/mTLS, provider side effects or backup/restore behavior.
