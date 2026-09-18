# ADR-245 — Bind fulfillment observations to order identity

## Decision

`FulfillmentSnapshot` carries the merchant tenant and customer identity in
addition to `order_id`. `assertFulfillmentIntegrity()` requires all three
identifiers to match the checkout order before validating quantities, tracking
and delivery timestamps.

## Rationale

An order ID is only safe as a join key inside a fully trusted, collision-free
merchant boundary. Provider integrations, migrations and multi-tenant systems
can return an ID from the wrong scope. Requiring the explicit identity join
prevents a cross-tenant fulfillment record from becoming a green post-purchase
journey.

## Boundary

This proves identity and line-level binding of the observed fulfillment. It
does not prove carrier possession, physical delivery, inventory reservation,
warehouse SLA or customer-visible tracking availability.
