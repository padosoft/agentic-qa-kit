# ADR-184: Verify provider-observed dispute evidence

## Context

Settlement reconciliation can detect lost chargebacks, but a settlement
snapshot alone does not prove that an active dispute is linked to the correct
order and payment, that evidence deadlines are present, or that the result is
isolated to the requesting customer.

## Decision

Add the optional `dispute_observer` capability and `observeDisputes()` contract.
`verifyDisputeJourney()` validates provider-returned order/payment identity,
tenant/customer ownership, non-empty unique chargebacks, amount/currency
bounds, evidence deadlines for opened disputes and an expected status/minimum
count when requested. The aggregate suite may include it for systems with a
pre-existing provider dispute.

## Boundary

The journey observes disputes; it does not manufacture a provider dispute or
claim that a payment network accepted a chargeback. Sandbox/staging provider
controls must induce the dispute and expose authoritative evidence. Representment
submission, network deadlines and final settlement remain provider-specific.
