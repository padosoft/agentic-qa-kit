# ADR-238 — Provider-backed Stripe refund reconciliation

## Decision

Add a bounded Stripe read-back reconciliation boundary. It retrieves the
PaymentIntent, requires provider status `succeeded`, compares
`amount_received` with the merchant-authoritative captured amount, reads at
most one complete refund page, rejects `has_more`, and sums only successful
refunds. The resulting provider observation is accepted only when its total and
currency match the merchant-authoritative refund total.

## Boundary

This closes payment/refund ledger reconciliation against a real provider HTTP
boundary. It does not claim that disputes, payouts, tax, fulfillment or the
merchant order transaction are reconciled; those require their own provider
observations and durable merchant-side joins. No secret key or raw provider
payload is included in the returned evidence.
