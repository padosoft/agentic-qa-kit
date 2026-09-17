# ADR-062 — PostgreSQL SCIM token store

## Status

Accepted — 2026-09-17

## Decision

Provide `PostgresScimTokenStore` as the durable implementation of the auth
package's hash-only `ScimTokenStore`. It creates its table under a transaction
advisory lock, indexes tenant/expiry, removes expired non-revoked records on
writes, and exposes `close()`. `aqa admin` can construct it from
`AQA_SCIM_TOKEN_DSN`; Helm maps that DSN to the configured PostgreSQL secret.

## Rationale

SCIM bearer tokens must survive process restarts without persisting plaintext.
Keeping the store behind the auth interface allows Vault/gateway-specific
issuance and verification policies while making the default self-hosted path
durable and tenant-aware.

## Evidence and limits

The local auth suite covers the interface and skips the PostgreSQL round-trip
without `AQA_TEST_POSTGRES_DSN`; CI's PostgreSQL job is the authoritative live
evidence. Atomic rotate, administrative token APIs and rate limiting remain
follow-ups.
