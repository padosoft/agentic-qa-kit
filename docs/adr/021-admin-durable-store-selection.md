# ADR-021 — Explicit durable store selection for `aqa admin`

## Status

Accepted — 2026-09-17

## Context

The admin process previously always created a `MemoryStore`. That was useful
for local demos but made the same command silently lose runs, findings and
configuration at process exit, even when a PostgreSQL queue was configured.
Durable queue state without durable control-plane state is not a production
deployment contract.

## Decision

`runAdmin` accepts an injected `StoreProvider` for host applications and a
`storeDsn` option. The CLI configuration path is `AQA_STORE_DSN`; when it is
set, `PostgresStore` is selected. `MemoryStore` remains the explicit local
default. `AQA_QUEUE_DSN` remains independent because queue and control-plane
scaling can differ. The selected store is closed during graceful shutdown,
and conflicting injection plus DSN options fail before boot.

## Consequences

Operators can make persistence a visible deployment choice and can verify
restart durability using the existing PostgreSQL contract. The DSN is not
printed or accepted as a command-line secret. PostgreSQL TLS, credentials,
backups, migrations and tenant authorization remain operational controls; this
ADR does not claim those controls are automatically configured.

