# ADR-069 — Durable webhook effect ledger

## Status

Accepted — 2026-09-17

## Decision

`@aqa/commerce` exposes `applyWebhookEffectOnce(ledger, effectKey, eventId,
effect)`. The first claim runs the effect, the same event is a duplicate, and
another event reusing the logical effect key fails closed. The PostgreSQL
implementation uses a primary key on `effect_key` and atomic
`INSERT ... ON CONFLICT DO NOTHING`; the memory implementation is for local
and deterministic tests.

## Rationale

Webhook signatures authenticate delivery but do not prevent duplicate business
effects. The logical key must represent the business invariant (for example,
one capture for one order/payment), while the provider event ID identifies the
delivery source. This separation handles retries, multiple event IDs and
out-of-order provider delivery without assuming provider idempotency forever.

## Evidence and limits

Commerce tests prove first-claim, duplicate and conflicting-event behavior;
the PostgreSQL cross-instance contract runs when `AQA_TEST_POSTGRES_DSN` is
configured and is an explicit local skip otherwise. The ledger does not claim
provider settlement, reconciliation or transaction coupling with an external
merchant database; the consumer must choose its effect key and transactional
outbox strategy.
