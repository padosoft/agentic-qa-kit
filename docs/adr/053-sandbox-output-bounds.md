# ADR-053 — bounded container tool output

## Status

Accepted — 2026-09-17

## Decision

`ContainerSandbox` applies a combined stdout/stderr byte cap per tool call, defaults to 1 MiB, kills the child when the cap is crossed and returns a failed, explicit outcome. The cap is passed through the injectable executor so the production and deterministic test paths share the same policy contract.

The output limit is independent from call count, CPU/memory limits and timeout. It is not a claim that the container runtime itself is a hostile-code boundary; image digest pinning, rootless runtime and stronger VM isolation remain deployment requirements.

## Evidence

Sandbox typecheck, 11/11 tests, repository lint and diff check pass. The contract includes a fail-closed output-limit regression.
