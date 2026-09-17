# ADR-063 — PostgreSQL SAML replay guard

## Status

Accepted — 2026-09-17

## Decision

`PostgresSamlReplayGuard` implements the `SamlReplayGuard` contract with an
assertion-ID primary key and one atomic `INSERT ... ON CONFLICT DO NOTHING`
claim. Expired claims are removed as part of the claim statement, and schema
migration is serialized with a PostgreSQL advisory transaction lock.

## Rationale

SAML replay prevention is a concurrency invariant, not a best-effort cache.
The guard stores only assertion IDs and expiry metadata; signature/XML parsing
remains an injected maintained provider adapter and is never reimplemented in
the database layer.

## Evidence and limits

The PostgreSQL contract test covers a claim surviving a store-instance restart
and rejecting a second claim. It is skipped locally without a DSN and runs in
the hosted PostgreSQL job. Real IdP metadata rollover and external HTTP login
journeys remain deployment work.
