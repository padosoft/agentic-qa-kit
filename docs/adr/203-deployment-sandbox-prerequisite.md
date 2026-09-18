# ADR-203: Deployment gate for sandbox image configuration

## Status

Accepted

## Context

The CLI's hardened profiles require an immutable sandbox image, but a worker
deployment could previously be rendered without passing `AQA_CONTAINER_IMAGE`.
That made a chart appear deployable while a release-gate shell probe would fail
only after scheduling.

## Decision

Production doctor reports a failing `production-sandbox-image` check unless
`AQA_CONTAINER_IMAGE` is a full immutable SHA-256 reference. The Helm runner
has `runner.sandbox.image` and `runner.sandbox.requirePinnedImage`; when an
enabled worker requires pinning, template rendering fails if the image is
missing and otherwise injects it into the worker environment.

This is a configuration gate only. The chart does not claim to provision a
Docker/Podman runtime, socket policy, registry admission or VM isolation.

## Consequences

An operator gets a render-time failure instead of a delayed runtime failure,
and the CLI doctor exposes the same prerequisite without leaking the image
value. A real deployment still needs a controlled OCI runtime and a fresh
hosted/cluster evidence record.
