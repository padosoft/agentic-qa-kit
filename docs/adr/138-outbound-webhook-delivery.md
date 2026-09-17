# ADR-138: Provider-neutral outbound webhook delivery

**Status:** Accepted  
**Date:** 2026-09-17

## Context

Enterprise integrations must not each reinvent retries, signatures,
idempotency, rate limiting and failure triage. Directly calling Slack, Jira or
PagerDuty from an API request couples product availability to a vendor and
loses failed deliveries.

## Decision

Create `@aqa/integrations` around a provider-neutral delivery contract. A
delivery has a stable ID, tenant, integration, URL, payload and secret. The
reference queue signs the exact JSON body with HMAC-SHA256, injects a transport,
retries bounded failures with exponential backoff and `Retry-After`, rate-limits
per integration, and moves poison deliveries to an explicit DLQ after five
attempts.

The in-memory implementation is deterministic test/reference infrastructure.
Production must provide an atomic durable queue, secret-manager lookup,
redacted audit records, metrics, retention and an authenticated operator
redrive path. Vendor adapters remain thin templates over this contract.

## Consequences

- Vendor outages no longer block the originating API request.
- Delivery attempts are observable and safely retryable by stable ID.
- HMAC protects payload integrity but does not replace TLS, secret rotation or
  destination allowlisting.
- A real PostgreSQL queue and provider journey tests remain required before
  claiming production-ready integrations.
