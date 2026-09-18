# ADR-250: Provide a protected manual production-evidence gate

## Status

Accepted

## Context

The repository can validate a signed production evidence pack and its binding
to a backup inventory and restore drill, but the evidence contains deployment
observations that must not be committed to Git. A documented command alone is
easy to run inconsistently and leaves no CI audit trail.

## Decision

Add a manually triggered GitHub Actions workflow protected by the
`production-evidence` Environment. It accepts the redacted pack, inventory,
restore drill, trust-root public key and signing key ID only as protected
secrets, writes them to a mode-700 temporary directory, runs `aqa dr
release-gate`, and removes the files in an `always()` cleanup step.

## Boundary

The workflow proves cryptographic integrity, schema validity, key identity and
cross-document binding. It does not contact PostgreSQL, S3, KMS, an IdP or a
runner fleet and therefore cannot substitute for provider execution evidence.
