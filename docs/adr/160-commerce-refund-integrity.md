# ADR-160: Validate payment/refund state reconciliation

## Status

Accepted

## Context

Commerce providers can return schema-valid payment snapshots that are
financially inconsistent. A positive `refunded_amount` with a non-refunded
status, or `partially_refunded` with zero refunded amount, can create a false
green checkout/refund assurance result.

## Decision

`assertPaymentIntegrity` parses the runtime snapshot and enforces the payment
refund state machine:

- zero refunded amount requires a non-refunded state;
- a strictly positive amount below capture requires `partially_refunded`;
- an amount equal to capture requires `refunded`;
- an amount above capture is rejected.

Successful refund results must also have a positive amount no larger than the
cumulative refunded amount observed on the payment.

## Evidence and boundary

The commerce contract suite covers the inconsistent-state regressions and
passes locally (28/28). This is provider-neutral observation validation; live
payment settlement, webhook delivery and financial reconciliation remain
deployment/provider evidence.
