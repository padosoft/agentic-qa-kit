# ADR-145: Commerce loyalty ledger contract

**Status:** Accepted  
**Date:** 2026-09-17

## Context

Loyalty points are financial-like value. A mutable balance can drift under
replayed order events, duplicate redemption messages or incorrectly signed
earn/expire entries.

## Decision

Add `LoyaltyAccountSnapshot` and `LoyaltyTransactionSnapshot` contracts. The
account balance must reconcile exactly to a deduplicated ordered transaction
set. Earn/adjust entries increase points, redeem/expire entries decrease them,
and the running balance may never be negative.

The contract does not settle rewards or define marketing rules. Provider
adapters remain responsible for atomic ledger writes, idempotency references,
expiration scheduling and customer-facing redemption authorization.
