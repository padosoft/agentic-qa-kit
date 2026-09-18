# ADR-226 — Authenticated remote runner queue

- Status: accepted
- Date: 2026-09-18

## Context

The durable worker previously connected directly to PostgreSQL. The control
plane already authenticated HTTP queue routes with scoped runner JWTs, but a
separate runner process could not use that boundary: it had no HTTP queue
adapter, lease-renewal route, or proof that identity rotation was honored
without restarting the process.

## Decision

Add `HttpRunnerQueue`, implementing the worker-facing dequeue/get/renew/ack/fail
contract over the authenticated runner API. It invokes a token source on every
request, allowing a projected secret or short-lived JWT file to rotate during a
run. The server adds scope-checked `GET` and `renew` routes; existing ACK/fail
routes remain lease-token fenced. Control-plane operations such as enqueue,
snapshot, reaping and cancellation are deliberately unavailable to the remote
runner.

## Consequences

The worker can now be isolated from the database and granted only the runner
HTTP surface. The complete journey proves real HTTP process separation,
RS256 issuer/audience/expiry validation, tenant scope isolation, lease renewal,
ACK fencing and token rotation. TLS/mTLS termination, secret projection,
revocation distribution and multi-replica load-balancer behavior remain
deployment evidence rather than claims of this in-process HTTP test.
