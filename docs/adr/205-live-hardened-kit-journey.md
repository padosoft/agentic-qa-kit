# ADR-205: Live complete journey for the hardened kit profile

## Status

Accepted — 2026-09-18

## Context

The lower-level sandbox contract and the kit routing test used an injected
executor. Those checks did not prove that a real `release-gate` run selects the
container boundary, invokes the OCI runtime, and evaluates a shell probe.

## Decision

The OCI CI job resolves the digest of a pulled Alpine test image and exports it
as `AQA_CONTAINER_IMAGE`. It then builds `@aqa/kit` and runs the complete
`run-cmd` journey with `AQA_TEST_CONTAINER_RUNTIME=docker`. The fixture uses a
real release-gate profile and a shell probe; success requires a scenario run,
zero findings and a passing result.

The journey is skipped locally when Docker and the test environment are absent.
That skip is explicit and is never treated as evidence of production runtime
availability.

## Consequences

The CI evidence now covers both the sandbox primitive and the kit integration
boundary. It still does not prove Kubernetes socket policy, VM isolation,
registry admission, or a hostile multi-tenant deployment.
