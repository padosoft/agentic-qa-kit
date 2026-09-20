# ADR-227 — Worker token-file rotation

- Status: accepted
- Date: 2026-09-18

## Context

`HttpRunnerQueue` supports per-request token resolution, but the executable
worker still selected the PostgreSQL queue directly. A Helm worker could
therefore appear to have a server URL while bypassing the authenticated
control-plane boundary. Boot-time environment tokens also make short-lived JWT
rotation require a restart.

## Decision

`aqa worker` selects `HttpRunnerQueue` when `AQA_SERVER_URL` is configured and
requires `AQA_RUNNER_TOKEN_FILE` for remote workers. A static
`AQA_RUNNER_TOKEN` is intentionally rejected by the executable because it
cannot bind a lease to a verified runner subject. The file source is read
for every queue request. The Helm StatefulSet requires a Secret reference,
mounts its selected key at `AQA_RUNNER_TOKEN_FILE`, and fails chart rendering
when the reference is absent. Direct PostgreSQL queue mode remains available
only when no server URL/token is configured, for explicitly local deployments.

## Consequences

Projected Secret updates can rotate runner JWTs without worker restart and the
default production-shaped chart cannot silently run an unauthenticated remote
worker. Kubernetes Secret propagation timing, TLS/mTLS, token issuer
revocation and provider-specific identity lifecycle remain operator evidence;
the worker never logs token contents.
