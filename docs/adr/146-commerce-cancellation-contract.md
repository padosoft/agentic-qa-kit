# ADR-146: Commerce cancellation and compensating refund contract

**Status:** Accepted  
**Date:** 2026-09-17

## Context

Cancellation is ambiguous when a payment has already been captured. Returning
`accepted` without linking the compensating refund can leave the merchant
charged and the order cancelled, while a timeout may be mistaken for a
completed cancellation.

## Decision

Add `CancellationSnapshot` with explicit requested/accepted/rejected states.
Decided states require `decided_at`; an accepted cancellation of a non-failed
payment requires `refund_id`. The contract links the cancellation to the exact
order and leaves provider idempotency/reconciliation to the adapter.

## Consequences

- Unknown or pending outcomes cannot be silently represented as success.
- Cancellation and refund evidence remain independently auditable.
- Provider-specific void-before-capture and refund-after-capture behavior must
  be verified by real adapters.
