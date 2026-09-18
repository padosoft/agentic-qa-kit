# ADR-234: Verify S3 server-side encryption at the artifact boundary

## Status

Accepted

## Context

Production evidence and audit artifacts require encryption at rest, but sending
an encryption option in a `PutObject` request is not proof that a compatible
provider applied it. A misconfigured bucket, ignored request header or wrong KMS
key could leave artifacts readable under a weaker policy while the application
reports success.

## Decision

`S3ArtifactStore` supports `AES256`, `aws:kms` and `aws:kms:dsse` server-side
encryption. Callers may provide an exact `sseKmsKeyId`; when
`verifyEncryption: true` is enabled, the store reads back `HeadObject` for both
the artifact and metadata objects and fails closed unless the encryption mode
and configured KMS key identity match.

The check is opt-in for compatibility with existing local and private-cloud
deployments. Production profiles should configure it together with the provider
bucket policy and Object Lock verification. The adapter does not create or
rotate keys, validate IAM/KMS policy, or prove regional replication; those remain
deployment and provider evidence requirements.

## Consequences

The runtime now detects a provider that silently ignores or downgrades requested
encryption before returning a successful artifact write. Operators must grant
the runtime access to the selected KMS key and account for provider-specific
key-identity representation when configuring the exact read-back value.
