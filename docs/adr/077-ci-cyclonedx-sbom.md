# ADR-077 — CI CycloneDX SBOM for the built repository

## Status

Accepted — 2026-09-17

## Decision

The build job generates a CycloneDX JSON SBOM with a pinned Anchore
`sbom-action` commit and uploads it as a CI artifact. A Node runtime check
rejects missing, malformed, empty, or non-CycloneDX output.

The action scans the checked-out repository after the workspace build. The
SBOM is evidence for the CI build, not a declaration that a production image,
published package, or pack has been independently signed. Release workflows
must attach provenance to the exact distributable artifact when those paths are
finalized.

## Rationale

The repository is Bun-first and has no root `package-lock.json`; `npm sbom`
reports an incomplete dependency tree and cannot be the authoritative
generator. Syft, through the pinned action, inventories the built repository
without mutating the Bun lockfile or committing generated files.

## Evidence and limits

- The workflow has an explicit SBOM artifact and schema/content gate.
- The local environment cannot reproduce GitHub's action-hosted Syft binary;
  CI must provide the first hosted evidence.
- This does not replace image scanning, license policy, pack-level SBOMs, or
  verification that the SBOM corresponds byte-for-byte to a published image.
