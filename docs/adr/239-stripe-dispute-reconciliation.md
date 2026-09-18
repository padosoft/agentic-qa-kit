# ADR-239 — Provider-backed Stripe dispute reconciliation

## Decision

Add a bounded Stripe dispute read-back boundary. The gateway lists at most one
complete dispute page for a PaymentIntent, requires every returned dispute to
link to that exact PaymentIntent, allowlists Stripe's known dispute lifecycle
states, parses `evidence_details.due_by` into a redacted ISO timestamp, and
compares the provider exposure total with the merchant-authoritative amount.

Unknown statuses, incomplete pagination, malformed deadlines, cross-payment
links, currency mismatch and amount drift fail closed.

## Boundary

This proves provider-observed dispute exposure, not settlement accounting. A
`won` or open dispute is not a lost chargeback, and payout timing, fees,
representment submission and durable merchant order joins remain separate
provider/deployment evidence requirements. No secret key or raw provider
payload is returned in evidence.
