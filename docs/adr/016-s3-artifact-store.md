# ADR-016: S3-compatible artifact storage

- Status: accepted
- Date: 2026-09-17

## Context

Filesystem artifacts are appropriate for a single local run but do not provide
durability, cross-replica access or Object Lock retention. The enterprise plan
requires AWS S3 and air-gapped MinIO compatibility without changing callers of
the artifact contract.

## Decision

Add `S3ArtifactStore` implementing the existing `ArtifactStore` interface. It:

- redacts text and JSON before hashing and upload;
- stores a SHA-256 reference and metadata sidecar;
- verifies the digest on reads;
- rejects relative-key traversal and supports an explicit tenant prefix;
- optionally sends S3 Object Lock retention mode/date on both content and
  metadata objects; and
- accepts an injected S3 client for deterministic tests and custom endpoints.

Credentials, endpoint configuration, bucket versioning, Object Lock enablement,
KMS policy and tenant authorization remain outside the adapter. A prefix must be
derived from authenticated scope, never directly from a user-provided key.

## Consequences

AWS S3, MinIO and compatible stores can be selected without changing runner or
reporter contracts. The adapter is not itself proof of WORM compliance: the
bucket policy and deployment configuration must be validated separately.
