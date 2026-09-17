# ADR-158 — Atomic promotion redemption ledger

## Status

Accepted — 2026-09-17

## Context

Validating a promotion snapshot at checkout commit time prevents expired or
over-limit input from being accepted, but it does not serialize two replicas
redeeming the last available use. A provider-neutral commerce assurance layer
needs an explicit idempotency and concurrency boundary.

## Decision

Add `PromotionRedemptionLedger` with `claimed`, `duplicate`, `conflict` and
`exhausted` outcomes. The in-memory implementation is for local contracts.
The PostgreSQL implementation locks each promotion code with a transaction
advisory lock, checks the hard cap, and inserts the redemption identifier in a
unique table. Reusing a redemption identifier for another code fails closed.

The ledger records the claim; settlement, coupon accounting, and provider
financial reconciliation remain merchant/provider responsibilities.

## Evidence and limits

Commerce typecheck and **29 tests** pass locally, including idempotency,
conflict and cap behavior. The two-client PostgreSQL race is wired into the CI
contract; live merchant settlement and provider-backed promotion semantics are
not claimed.
