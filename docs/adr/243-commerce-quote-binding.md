# ADR-243 — Bind tax and shipping quotes to the tested cart

## Decision

Tax and shipping observations include the `cart_id` that the merchant
provider quoted. The journey creates and mutates one cart, then requires the
returned quote to carry that exact ID. Shipping observations must additionally
return the same normalized country, postal code, city and region as the
requested destination. Currency, non-negative amounts, unique rates and
bounded delivery estimates remain independently enforced.

## Rationale

An amount and currency alone do not prove that a quote belongs to the current
cart. A stale cache, cross-tenant response or provider race could otherwise
produce a false green release gate. The binding is deliberately explicit in
the versioned contract so a real HTTP merchant adapter cannot hide the join.

## Boundary

This proves the provider response is bound to the observed cart and requested
destination. It does not claim tax-law correctness, jurisdiction liability,
carrier availability, final checkout price or fulfillment execution; those
require merchant/provider-specific evidence.
