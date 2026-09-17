# ADR-068 — Stripe-style webhook signature boundary

## Status

Accepted — 2026-09-17

## Decision

`@aqa/commerce` exposes `verifyStripeWebhookSignature(rawBody, header,
secret)`. It verifies the exact raw body using the `t=<unix>,v1=<hex>` signed
payload, accepts any valid `v1` signature during secret rotation, requires a
positive bounded timestamp tolerance and uses constant-time HMAC comparison.

## Rationale

Webhook delivery is an adversarial boundary. Parsing or reserializing JSON
before verification changes the signed bytes, and accepting old valid events
without a clock check permits replay. Signature verification is deliberately
separate from order/payment side effects: a valid delivery still requires a
durable event/effect idempotency key and reconciliation policy.

## Evidence and limits

Commerce tests cover valid raw-body delivery, stale timestamps and tampered
body rejection. The implementation has no payment-provider network access and
does not claim live Stripe credentials, settlement, retries or reconciliation.
