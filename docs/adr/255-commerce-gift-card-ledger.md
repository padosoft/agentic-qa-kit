# ADR-255 — Atomic gift-card stored-value ledger boundary

## Status

Accepted — 2026-09-18

## Context

Tender allocation proved only that a checkout total was mathematically
reconciled. It did not prove that a gift-card balance was durable, tenant
scoped, idempotent under retry or safe under concurrent redemption. Treating a
successful gift-card response as proof without those properties can hide
overspend and cross-tenant balance errors.

## Decision

Add a provider-neutral `GiftCardLedger` boundary with credit, redeem and
balance operations. Operation IDs are single-use: an identical retry is a
`duplicate`, while a changed payload is a `conflict`. Redemptions acquire a
per-tenant/card transaction lock and return `insufficient_funds` without
writing an entry when the balance is unavailable. Currency changes for an
existing card fail closed. The in-memory implementation is deterministic for
contract tests; the PostgreSQL implementation persists append-only entries and
uses transaction-scoped advisory locks for the durable concurrency boundary.

## Consequences

- Commerce journeys can test stored-value invariants without faking a green
  provider observation.
- Gift-card redemption is not confused with a card payment or a discount.
- Provider-specific gift-card APIs, settlement, expiry, reload and legal
  liability remain explicit integration evidence and are not claimed here.

## Evidence

`packages/commerce/test/tender-ledger.test.ts` covers idempotent credit/redeem,
conflicting operation reuse, tenant/currency isolation and concurrent
overspend prevention. The PostgreSQL concurrency test runs when
`AQA_TEST_POSTGRES_DSN` is configured; without it the test reports an explicit
environment skip.
