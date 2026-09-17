# ADR-027 — Verifiable air-gap deployment contract

## Status

Accepted — 2026-09-17

## Context

The original air-gap script only created and hashed a bundle; an operator
could not install it offline, and the documentation overstated the future
Cosign boundary. A production bundle must reject traversal/link payloads,
verify every digest before execution, load local image tarballs and install a
pinned chart without contacting a registry.

## Decision

`scripts/air-gap-install.sh install` verifies the bundle safely, optionally
requires a Cosign blob signature, loads image tarballs with Docker or Podman,
and runs `helm upgrade --install` with explicit release, namespace, values and
kube context options. The Terraform module can optionally own a Helm release
or leave chart ownership to a platform team. `bash -n` is a CI gate; runtime
installation still requires an OCI runtime, Helm and a configured cluster.

## Consequences

The offline deployment path is executable and its trust checks are explicit.
Unsigned bundles remain acceptable only when the operator does not request
Cosign enforcement; regulated deployments should set `COSIGN_REQUIRED=true`
and provide a pinned public key. Cloud database, identity and key-management
bindings remain provider/platform inputs rather than unsafe generic defaults.
