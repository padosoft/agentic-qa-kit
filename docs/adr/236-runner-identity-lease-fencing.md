# ADR-236 — Bind runner lease mutations to authenticated identity

## Decision

When the runner authorization boundary returns a `runner_id`, queue dequeue
stores it as the lease owner. Renew, ACK and fail operations must match both the
lease token and the owner identity. The in-memory queue and PostgreSQL queue
implement the same contract; REST routes pass the verified JWT subject through
the queue boundary, and the worker propagates its configured identity for
direct PostgreSQL operation.

Legacy callers without an identity remain compatible for local development and
old leases. A lease already bound to an identity cannot be mutated by an
identity-less or different runner.

## Rationale and boundary

Tenant/project scopes answer *where* a runner may work; identity fencing also
answers *which authenticated runner* owns the current lease. This prevents a
stolen or misrouted same-scope worker from acknowledging or failing another
worker's job. It does not replace JWT signature, issuer, audience, rotation or
mTLS policy, which remain deployment authentication controls.
