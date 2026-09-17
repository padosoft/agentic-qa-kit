# ADR-183: Verify subscription dunning evidence

## Context

Subscription creation and read-after-write do not prove that a failed renewal
is handled safely. Missing retry history, non-contiguous attempts, wrong
amounts, or cross-customer observations can produce silent churn and billing
incidents.

## Decision

Add versioned dunning-attempt snapshots, the optional `dunning_observer`
capability and `observeDunning()`. `verifyDunningJourney()` validates the
subscription ownership, contiguous attempt numbering, amount/currency linkage,
retry scheduling metadata, minimum attempt count and an observed failed
renewal. The journey remains optional in the aggregate suite because it needs
an existing subscription in a provider-controlled past-due state.

## Boundary

This is an observation contract, not a billing simulator and not a claim that
the provider actually attempted collection. Provider sandbox controls must
induce the failure and expose authoritative events. Retry policy, grace period,
invoice/tax generation, notification delivery and durable provider
reconciliation remain provider-specific evidence.
