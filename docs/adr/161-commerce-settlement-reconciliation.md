# ADR-161: Reconcile commerce settlement effects

## Status

Accepted

## Context

Checkout and refund journeys can pass while a payment provider's settlement
report drifts from the observed order history. Refunds, chargebacks and
provider totals must be checked as one financial boundary.

## Decision

Expose `SettlementSnapshot` and `assertSettlementIntegrity` in `@aqa/commerce`.
The validator requires exact payment/order linkage, same-currency amounts,
successful refunds, lost chargebacks, and the equation:

```text
net = captured - refunded - lost_chargeback
```

The refund ledger must equal the payment's cumulative refunded amount, and
effects may not exceed the captured amount. Pending/open chargebacks and
failed/pending refunds are not silently treated as settled evidence.

## Evidence and boundary

Commerce contracts pass locally (29/29), with build, typecheck, Biome and
diff-check green. This is a provider-neutral contract; real PSP settlement,
payout timing, fees, disputes and reconciliation exports remain deployment
evidence.
