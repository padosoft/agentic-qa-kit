# ADR-015: Atomic finding status audit

- Status: accepted
- Date: 2026-09-17

## Context

Changing a finding status and recording the corresponding audit event are one
business operation. The previous HTTP implementation performed the update and
event append separately. A concurrent request could therefore leave a changed
finding without an event, duplicate sequence numbers, or fork the hash chain.

## Decision

`StoreProvider` exposes `transitionFindingStatus`. Implementations must mutate
the finding and append its hash-chained event atomically, returning both values
or no result when the finding does not exist.

The PostgreSQL adapter executes the read/hash/update/insert sequence in one
transaction and takes a transaction-scoped advisory lock. The lock is required
even when the audit table is empty: locking only the current tail row does not
serialize two first writers. The in-memory adapter implements the same observable
contract for local development and unit tests.

## Consequences

- API callers cannot accidentally bypass the audit pairing.
- Sequence and hash-chain integrity is serialized across PostgreSQL clients.
- The advisory lock is intentionally global to the audit stream; high-volume
  deployments should shard the stream and lock key only after defining a
  tenant-scoped audit model.
- The live PostgreSQL concurrency test is mandatory CI evidence; local tests
  without `AQA_TEST_POSTGRES_DSN` do not prove the durable behavior.
