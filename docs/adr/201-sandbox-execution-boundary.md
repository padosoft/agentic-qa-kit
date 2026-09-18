# ADR-201: Sandbox execution boundary for shell probes

## Status

Accepted

## Context

`@aqa/sandbox` had a real OCI implementation, but the CLI scenario path did
not select it. A shell probe could therefore be declared while the run had no
host-owned isolation boundary.

## Decision

For orchestrator profiles named `security` or `release-gate`, `aqa run` creates
a `ContainerSandbox` when the host has not injected a probe runner or sandbox.
Shell probes are dispatched through that sandbox with bounded calls, a
read-only root, no network, resource limits, dropped capabilities,
`no-new-privileges` and a non-root user. An injected `Sandbox` is authoritative
for embedders and tests. HTTP probes continue through the origin-scoped HTTP
driver and are not silently moved into the container.

Smoke/development profiles do not create a container automatically. Their
shell probes remain unsupported unless the host explicitly supplies a sandbox,
so local convenience cannot be mistaken for a release security guarantee.

## Consequences

The CLI now reaches the existing container policy at the last responsible
execution boundary. OCI runtime/image availability is still deployment
evidence; an injected executor test does not prove a Docker or Podman host.
The sandbox is a shell-tool boundary, not complete VM isolation for every
possible provider, browser or HTTP side effect.
