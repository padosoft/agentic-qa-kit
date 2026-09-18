# ADR-230: Bind production evidence to the restore-drill digest

## Status

Accepted — 2026-09-18

## Context

Production evidence previously identified a recovery exercise with
`restore_drill_ref` only. An identifier is useful for lookup but does not
cryptographically bind the signed production envelope to the exact drill
record that was reviewed.

## Decision

`controls.database_recovery` requires `restore_drill_sha256`, a lowercase
SHA-256 digest of the canonical restore-drill evidence record, in addition to
the bounded human/operator reference. The parser validates the digest before
signing or verification, so replacing the referenced drill requires a new
signed production observation.

`@aqa/compliance` exposes `canonicalRestoreDrillEvidence` and
`restoreDrillEvidenceSha256` so operators and release automation use the same
validated canonical representation when producing the digest.

`verifyProductionEvidenceRestoreBinding` performs the complete join: trusted
signature verification, inventory validation, drill validation, reference
matching and digest matching.

## Consequences and boundary

This closes substitution ambiguity in the evidence handoff. It does not
execute or independently attest the drill; the digest is meaningful only when
the release process stores the canonical drill record in the approved evidence
workspace and verifies its provenance.
