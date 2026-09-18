# ADR-259 — Protected live artifact-provider evidence

## Status

Accepted — 2026-09-18

## Context

`S3ArtifactStore` already requests and verifies Object Lock retention and
server-side encryption. A local MinIO job proves the adapter contract, but it
cannot establish the customer's cloud KMS permissions, key identity or
production bucket posture.

## Decision

Add a manual workflow bound to `production-artifact-evidence`. It requires
operator-owned endpoint, region and credentials, optionally requires an exact
KMS key identity, and executes the existing read-back journey against an
isolated bucket. Missing or contradictory settings fail before provider calls.

## Consequences

- A successful run proves the configured endpoint applied and returned the
  requested retention/encryption state for both artifact objects.
- It does not claim key rotation, IAM, replication, PITR, backup or RTO/RPO.
- Synthetic CI remains separate from production/provider evidence.
