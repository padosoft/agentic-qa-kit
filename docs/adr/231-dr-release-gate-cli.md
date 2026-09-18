# ADR-231: Expose the restore-evidence binding as a release gate

## Status

Accepted — 2026-09-18

## Context

The compliance package could verify the signature and cross-document binding
between a production evidence envelope, a backup inventory and a restore drill,
but the operator CLI exposed only the individual inventory and restore checks.
Release automation therefore had to reproduce the join logic and could drift
from the canonical verifier.

## Decision

Add `aqa dr release-gate <inventory> <restore-evidence>
<production-evidence> --public-key <pem>`. The command reuses the existing
validated parsers and `verifyProductionEvidenceRestoreBinding`; it does not
implement a second cryptographic or canonicalization path. It fails closed when
the trust root is absent, the inventory is invalid, the drill violates its
objectives, the production envelope is unsigned/invalid, or the drill reference
and digest do not match.

The supplied public key is the approved trust root for signed inventory and
production evidence. An unsigned inventory can still be used for local
contract validation, but cannot be described as provider-backed evidence.

## Consequences and boundary

Release pipelines now have one executable, machine-readable join gate and a
stable CLI output. This proves provenance and document consistency only; it
does not contact PostgreSQL, the artifact provider, KMS, the IdP or the runner
fleet, and it cannot replace a provider-backed restore drill.
