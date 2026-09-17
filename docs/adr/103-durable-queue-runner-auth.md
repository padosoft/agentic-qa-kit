# ADR-103: fail-closed runner authentication for durable queues

- Status: Accepted
- Date: 2026-09-17

## Decision

When `runAdmin` selects a PostgreSQL queue through `AQA_QUEUE_DSN` or
`queueDsn`, boot requires either an injected `runnerAuthorize` verifier or
`AQA_RUNNER_TOKEN`. The fallback verifier accepts only the exact `Bearer` form,
hashes both values with SHA-256 and compares the fixed-size digests using
`timingSafeEqual`. The secret is never included in errors, events or logs.

Memory-only local development remains compatible without runner credentials.

## Rationale and limits

The durable queue is a cross-process trust boundary; an unauthenticated dequeue
or ACK endpoint lets an unauthorized process consume or mutate tenant work.
The static token is intended for bootstrap/self-hosted environments. Production
enterprise deployments should replace it with mTLS or short-lived OIDC/JWT
runner identity, project scoping and rotation.

## Verification

Kit build, typecheck and the admin suite pass locally (14 tests, 0 failures).
