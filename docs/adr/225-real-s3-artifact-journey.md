# ADR-225 — Real S3-compatible artifact journey

- Status: accepted
- Date: 2026-09-18

## Context

The S3 artifact adapter already had deterministic injected-client tests. Those
tests proved redaction, digest verification and Object Lock request handling,
but did not prove that a compatible provider accepted bucket-level Object Lock,
persisted both artifact objects and metadata, or returned retention state on a
real read-back.

## Decision

Add a CI integration job backed by an ephemeral MinIO service. The test creates
a uniquely named Object Lock-enabled bucket, writes a redacted artifact through
`S3ArtifactStore` with `COMPLIANCE` retention and `verifyRetention`, then proves
download digest verification and metadata `head()` equality. The test is
endpoint-gated and skips in ordinary local package runs unless
`AQA_TEST_S3_ENDPOINT` is explicitly configured.

The test uses CI-only credentials supplied as environment variables. No
credential, endpoint secret or generated bucket name is committed or written to
artifacts. The disposable bucket is intentionally not deleted because Object
Lock prevents deleting the retained objects; the MinIO service is destroyed at
job end.

## Consequences

CI now proves the provider boundary for MinIO-compatible deployments, not AWS
regional behavior, KMS policy, replication, backup or disaster recovery. Those
remain infrastructure-specific evidence requirements. The adapter still cannot
infer tenant identity; callers must derive the prefix from authenticated scope.
