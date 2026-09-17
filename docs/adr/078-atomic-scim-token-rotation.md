# ADR-078 — Atomic SCIM token rotation

## Status

Accepted — 2026-09-17

## Decision

The SCIM token store may expose an atomic `rotate` operation. The PostgreSQL
implementation serializes rotation with a transaction advisory lock, revokes
only a live token in the requested tenant, and inserts the replacement in the
same transaction. The manager uses that operation when available and retains a
clearly scoped fallback for simple stores and local fixtures.

## Rationale

Separate revoke-then-issue calls leave a race window in which two replicas can
both rotate the same bearer token or a failure can leave the tenant without a
replacement. A transaction is the minimum durable contract for production
SCIM rotation; the fallback keeps the provider-neutral auth tests usable but is
not the multi-replica guarantee.

## Evidence and limits

- Existing manager tests preserve the fallback behavior and audit sequence.
- PostgreSQL CI must execute the durable path with two store instances before
  production HA rotation is claimed.
- Secret-manager wrapping, an authenticated administration endpoint, and
  retention/alerting for token audit events remain separate work.
