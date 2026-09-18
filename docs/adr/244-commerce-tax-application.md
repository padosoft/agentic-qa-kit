# ADR-244 — Verify tax quote application at checkout

## Decision

`verifyTaxJourney()` remains capable of validating a quote-only merchant, but
when the declared capabilities include checkout and the adapter exposes it,
the journey performs a separate checkout using a namespaced idempotency key.
The final order's tax currency and integer minor-unit amount must exactly equal
the bound provider quote. The evidence contains separate `tax.quote` and
`tax.applied` steps.

## Rationale

A valid tax quote is not proof that the merchant applied the tax to the order
that was paid. Requiring the final order join prevents a release gate from
passing while the checkout path silently drops or replaces the quoted tax.
The namespaced key prevents this optional verification from colliding with
other journeys that intentionally reuse their own idempotency key.

## Boundary

This proves quote-to-order application and arithmetic consistency. It does not
prove tax-law correctness, registration, filing, jurisdiction liability or
provider settlement. A merchant without an observable checkout remains
quote-only evidence and must not be described as final-tax assurance.
