# ADR-013 — Content-addressed artifact store boundary

## Status

Accepted for the first local/on-prem implementation; S3/MinIO adapter and WORM retention remain follow-ups.

## Decision

Artifacts are written through a small `ArtifactStore` contract. Text and JSON are redacted before hashing and persistence; binary data requires an explicit byte API. The filesystem adapter rejects absolute/parent-traversal keys, writes through a temporary file followed by an atomic rename, and returns a SHA-256 content reference plus metadata.

## Rationale

Replay, screenshot, trace and report producers need the same security boundary. Hashing after redaction means the stored digest identifies the evidence that can actually be retrieved, instead of proving bytes that were never allowed to persist. The contract leaves tenant authorization, encryption, retention/object-lock and cloud durability to deployment-specific adapters.

## Consequences

- Existing producers are not automatically migrated; integration into run finalization and API download routes is a required next step.
- `putBytes` cannot inspect arbitrary binary formats; screenshot/trace pipelines must either sanitize before calling it or use a format-aware adapter.
- A content hash is integrity evidence, not publisher identity, encryption, WORM retention or tenant authorization.
