# ADR-047 — Commerce tender and promotion invariants

## Status

Accepted — 2026-09-17

## Context

An ecommerce checkout can appear correct while accepting a payment split that does not reconcile to the order total, reusing the same tender twice, or redeeming a promotion that became invalid between cart pricing and order commit. These are financial correctness and abuse risks, not merely UI validation concerns.

## Decision

Keep two explicit, provider-neutral boundaries in `@aqa/commerce`:

- `assertTenderAllocation()` validates non-empty card, gift-card and store-credit allocations, rejects cross-currency values and duplicate tender IDs, and reconciles the exact minor-unit total with `BigInt` arithmetic.
- `assertPromotionRedeemable()` validates promotion currency, redemption limit and expiry at commit time. The cart quote is not treated as an authorization to redeem.

The contracts remain pure and injectable so payment, promotion and ledger providers can implement their own durable reservation/commit protocol around them. Provider settlement, atomic redemption counters, tax treatment, gift-card balance locking and reconciliation are separate integrations and are not claimed by this ADR.

## Consequences

The reference contract suite catches common split-tender and stale-promotion regressions without floating-point arithmetic or network dependencies. Production adapters must still perform an atomic conditional redemption and persist an auditable financial event before reporting success.

## Evidence

`@aqa/commerce` typecheck and 15/15 contract tests pass; repository lint and `git diff --check` pass for this slice.
