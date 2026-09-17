# ADR-116: durable commerce approval ledger

- Status: Accepted
- Date: 2026-09-17

## Decision

Add a `CommerceApprovalLedger` with an atomic `claim(approval_id, call_id)`
contract. The PostgreSQL implementation uses a unique approval key and
`INSERT ... ON CONFLICT DO NOTHING`; duplicate claims for the same call and
conflicting reuse are distinguishable. `CommerceToolPolicy.authorizeAsync()`
uses this ledger. If a policy has a durable ledger, synchronous `authorize()`
fails closed for writes so callers cannot accidentally bypass shared replay
protection.

## Consequences

- Multiple gateway replicas cannot consume one human approval twice.
- Approval issuance, audit retention and the final merchant mutation still need
  to be integrated in one provider-specific transaction/idempotency boundary;
  claiming alone is not a distributed rollback.
- Local deterministic tests can continue using the memory ledger.

## Verification

Commerce build/typecheck and **22 tests** pass locally. Live PostgreSQL race
evidence remains required.
