# ADR-256 — Provider gift-card lifecycle reconciliation boundary

## Status

Accepted — 2026-09-18

## Context

ADR-255 deliberately stopped at the merchant-owned stored-value ledger. That
boundary prevents local overspend and retry errors, but a merchant can still
silently disagree with the provider about card identity, balance or expiry.
A fixture or local ledger cannot prove the provider's gift-card API executed.

## Decision

Add `GiftCardProviderSnapshot`, `GiftCardProviderAdapter` and
`verifyGiftCardProviderJourney()` to `@aqa/commerce`. The journey requires an
authoritative, schema-validated provider observation and reconciles tenant,
gift-card ID, currency and exact minor-unit balance with the merchant ledger.
It also rejects an expired card without an elapsed `expires_at`, and an active
card whose expiry has already elapsed. Provider calls, credentials, settlement
and legal expiry semantics remain outside the package and must be supplied by
an explicitly configured integration adapter.

## Consequences

- A provider observation cannot be accepted for a sibling tenant/card or a
  drifted balance.
- Expiry evidence has an explicit temporal contract instead of relying on a
  status string alone.
- The package still does not claim Stripe/issuer execution, legal expiry
  compliance or settlement; those remain deployment-scoped evidence.

## Evidence

`packages/commerce/test/gift-card-provider.test.ts` covers a passing
reconciliation, identity mismatch, balance drift, future expiry and stale
active expiry. The provider adapter is intentionally injected and contains no
credentials or network calls.
