# ADR-202: Immutable sandbox image for hardened profiles

## Status

Accepted

## Context

An OCI policy can be strong while its image reference remains mutable. A tag
such as `ubuntu:24.04` can resolve to different bytes between runs, weakening
replay provenance and supply-chain review.

## Decision

The automatically selected `ContainerSandbox` for `security` and
`release-gate` requires an image reference ending in a full
`@sha256:<64 lowercase hex>` digest. The image is supplied through the
operator-owned `AQA_CONTAINER_IMAGE` environment variable. A caller that
injects its own sandbox owns that sandbox's image policy and must document it.
The generic sandbox API remains backwards-compatible for local tests and
development callers unless `require_pinned_image` is enabled.

Invalid hardened configuration returns a bounded run error before scenario
dispatch. The digest value is never printed by the kit.

## Consequences

Release deployments must publish and configure an immutable image digest,
which makes rollback and evidence identity explicit. Local release-gate runs
without that operator prerequisite fail closed instead of silently using a
mutable default tag.
