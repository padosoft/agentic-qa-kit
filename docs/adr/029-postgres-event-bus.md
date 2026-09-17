# ADR-029: PostgreSQL LISTEN/NOTIFY event bus

## Status

Accepted

## Context

The server needs a provider-neutral event boundary for admin live updates,
notifications and future integrations. A process-local emitter does not
fan out across replicas, while treating PostgreSQL notifications as a durable
queue would silently lose events during reconnects.

## Decision

Provide `EventBus` with `MemoryEventBus` for development/tests and
`PostgresEventBus` for self-hosted deployments. PostgreSQL uses a fixed,
validated channel and `LISTEN/NOTIFY`; payloads are limited to 7,500 UTF-8
bytes. Each published event is also written to a bounded-by-policy event log,
which supports tenant-scoped replay after an SSE `Last-Event-ID` cursor.
Subscriber failures are isolated. Callers must persist authoritative state
before publishing and reconcile from the store after reconnects.

## Consequences

- Replicas receive low-latency fan-out without introducing Redis/Kafka.
- `LISTEN/NOTIFY` delivery remains non-durable and at-most-once; it is
  unsuitable for job execution or audit storage. The event log only provides
  bounded reconnect replay and must have an operator-owned retention/pruning
  policy before long-lived production use.
- The same consumer contract can later sit behind Redis Streams/Kafka without
  changing API handlers.
- Production operators must provide PostgreSQL connectivity, event-log
  retention/pruning, and reconnect reconciliation at the consumer boundary.
