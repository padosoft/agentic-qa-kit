# ADR-031: Evidence-producing fix verification

## Status

Accepted

## Context

The kit could discover findings and replay scenarios, but a developer fixing a
finding had no bounded CLI operation that re-ran the original scenario and
left reviewable evidence. Treating a passing fixture or local replay as proof
of a CI, deployment, or pull-request result would overstate coverage.

## Decision

Add `aqa verify <finding-id>`.

- Resolve the finding from persisted run artifacts and resolve its scenario from
  project or installed packs.
- Require an explicit real-system `--base-url`, or an injected probe runner in
  programmatic use. Never fall back to the no-network stub.
- Run one to ten attempts, report deterministic versus non-deterministic
  outcomes, and write a uniquely named verification JSON artifact beside the
  source run.
- Return exit code 0 only for deterministic success and 2 for a completed
  non-deterministic replay.
- Do not auto-transition finding status or claim CI/deployment/PR evidence;
  those integrations require their own durable, authenticated contracts.

## Consequences

The command is safe to use in a developer fix loop and produces auditable
local evidence. It is intentionally not yet a complete enterprise closure
workflow: artifact-store routing, event-chain publication, durable finding
transitions, CI status checks, and GitHub integration remain follow-up work.
