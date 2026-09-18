# ADR-232: Enforce restore-evidence binding in production doctor

## Status

Accepted — 2026-09-18

## Context

The CLI release gate could bind a signed production evidence envelope to a
restore drill, but `aqa doctor --production` only checked the production pack's
signature, completeness and freshness. A deployment could therefore pass its
general evidence check while never presenting the exact drill record covered by
the signed digest.

## Decision

When `AQA_PRODUCTION_DR_INVENTORY_PATH` and
`AQA_PRODUCTION_DR_EVIDENCE_PATH` are configured, production doctor revalidates
the files and delegates the cryptographic join to
`verifyProductionEvidenceRestoreBinding`. Missing paths produce an explicit
warning; a partial configuration, unreadable input or mismatch fails the
binding check. The existing evidence check remains responsible for signature,
completeness and freshness.

## Consequences and boundary

Release readiness now exposes missing drill provenance instead of silently
passing it. The doctor still performs no provider calls and cannot prove that
PostgreSQL PITR, object restore, KMS, WORM or the identity exercise actually
ran; those remain deployment evidence obligations.
