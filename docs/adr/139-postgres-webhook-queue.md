# ADR-139: PostgreSQL webhook queue and secret references

**Status:** Accepted  
**Date:** 2026-09-17

## Context

The in-memory webhook state machine proves retry semantics but cannot survive a
worker restart or coordinate multiple replicas. Storing raw webhook secrets in
the queue would create an avoidable credential exposure in database backups,
logs and support tooling.

## Decision

`PostgresWebhookQueue` stores pending and dead deliveries in
`aqa_webhook_deliveries`. Workers claim due rows using `FOR UPDATE SKIP LOCKED`
and a five-minute lease, resolve `secret_ref` through an injected secret
manager, deliver outside the database lock, then delete successful rows or
update retry/DLQ state. `redrive(id)` resets only dead rows and is intended to
sit behind an authenticated, audited operator endpoint.

The durable queue also requires an exact HTTPS origin allowlist. URL
credentials are rejected; the transport must separately enforce DNS
rebinding and private/link-local IP protections.

## Consequences

- Multiple workers can scale horizontally without duplicate claims from the
  same queue row.
- Database contents and backups do not contain webhook signing secrets.
- Delivery is at-least-once: destinations must honor `x-aqa-delivery-id` for
  idempotency.
- Destination allowlisting, secret rotation, metrics, retention and the
  operator authorization boundary remain deployment responsibilities.
