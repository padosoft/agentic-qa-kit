# ADR-179: Verify fulfillment and RMA as post-purchase journeys

## Context

Checkout/payment coverage does not prove that inventory becomes a valid
fulfillment, tracking metadata is present, delivery is observable, or a return
request is bound to the original order and quantity. These are common sources
of customer-visible ecommerce regressions.

## Decision

Add optional fulfillment observation and return-request operations to the
commerce adapter. `verifyPostPurchaseJourney()` requires an observed
fulfillment and validates order/quantity/tracking invariants; callers may also
request an idempotent RMA creation and get return-line/currency validation.
The aggregate suite preserves unsupported and error outcomes.

## Boundary

The reference merchant proves contract semantics only. Real carrier tracking,
warehouse allocation, delivery events, refund-on-return and reverse-logistics
provider journeys remain deployment evidence.
