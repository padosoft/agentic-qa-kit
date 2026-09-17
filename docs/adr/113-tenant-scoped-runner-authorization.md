# ADR-113: tenant-scoped runner authorization

- Status: Accepted
- Date: 2026-09-17

## Decision

Runner authentication may return a `RunnerAuthorization` containing a runner
identifier and one or more allowed organization/project scopes. Queue dequeue
filters candidates before leasing, in both Memory and PostgreSQL implementations.
ACK and fail routes fetch the job and apply the same scope check before mutating
it. A legacy boolean `true` authorizer remains supported as an explicitly
unscoped compatibility/bootstrap mode.

## Consequences

- A runner assigned to one tenant cannot consume another tenant's queued work or
  close its lease, even when it knows the job ID and lease token.
- Scope filtering is part of the queue contract, not merely an HTTP convention,
  so direct queue consumers and durable implementations share the invariant.
- Production should issue short-lived mTLS/OIDC claims and avoid the unscoped
  boolean/static-token bootstrap path.

## Verification

Server build/typecheck and **125 tests** pass locally. PostgreSQL live scope
filtering remains required before production sign-off.
