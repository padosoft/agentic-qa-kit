# ADR-141: Redacted webhook audit and metrics observer

**Status:** Accepted  
**Date:** 2026-09-17

## Context

Durable delivery without operational evidence is not production-ready. Teams
need attempts, outcomes and retry/DLQ rates, but logging URLs, payloads,
secret references or provider content creates a data-leak path.

## Decision

`PostgresWebhookQueue` accepts an optional observer callback. It receives only
the delivery ID, tenant, integration, attempt number, HTTP status and bounded
state (`attempt`, `delivered`, `retrying`, `dead_lettered`). Observer failures
are swallowed and never change queue semantics. Hosts can map these events to
`MetricsRegistry`, OTel spans or `StructuredLogger` with bounded labels.

## Consequences

- Retry and DLQ behavior can be monitored without exposing webhook data.
- Metrics cardinality remains the host's responsibility; IDs must not become
  unbounded Prometheus labels.
- This is an integration hook, not an audit store: compliance-grade durable
  audit retention and access control remain host/deployment responsibilities.
