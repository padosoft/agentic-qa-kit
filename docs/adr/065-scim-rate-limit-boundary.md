# ADR-065 — SCIM rate-limit boundary

## Status

Accepted — 2026-09-17

## Decision

All SCIM routes invoke an injected tenant-scoped limiter before bearer
authorization and directory work. Exhaustion returns HTTP 429 with the stable
`scim_rate_limited` error. `aqa admin` supplies a bounded process-local
sliding-window default when SCIM is configured, while callers can inject a
shared implementation through `scimRateLimit`.

## Rationale

SCIM is an externally-triggerable write boundary. Limiting before token-store
lookups and provisioning prevents invalid or valid credentials from consuming
unbounded control-plane resources. Tenant identity is taken from the existing
validated SCIM scope header and is not replaced with an untrusted IP-only key.

## Evidence and limits

The auth suite covers tenant isolation, exhaustion and window reset. The
default limiter is process-local and bounded to 10,000 tenants; Redis/Postgres
atomic counters, `Retry-After` headers and multi-replica load evidence remain
required for production HA.
