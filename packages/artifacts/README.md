# @aqa/artifacts

Redaction-aware artifact storage for logs, screenshots, traces, reports and replay evidence.

`FileArtifactStore` is the local implementation. `S3ArtifactStore` targets AWS S3, MinIO and compatible private-cloud APIs. Text and JSON pass through pre-write redaction, binary artifacts require an explicit `putBytes` call, paths are relative and traversal-safe, and every reference carries a SHA-256 digest. S3 writes can optionally request Object Lock governance/compliance retention, AES256 or customer-managed KMS encryption, and use an authenticated tenant prefix. Production callers can enable read-back verification so a backend that ignores, shortens or downgrades the requested retention/encryption fails closed immediately.

The S3 adapter does not create buckets, configure versioning/Object Lock, manage KMS keys or authorize tenants. Operators must enable those bucket controls, grant the runtime access to the configured KMS key, and derive prefixes from an authenticated tenant at the API boundary. `FileArtifactStore` remains non-WORM and is intended for local/dev use.

The protected manual `artifact-provider-evidence.yml` workflow runs the
read-only provider journey against an operator-owned S3-compatible endpoint.
It can require an exact KMS key identity and always verifies Object Lock and
encryption read-back for the artifact and metadata sidecar. A passing run is
provider evidence for that endpoint at that time, not proof of rotation,
replication, IAM review or disaster recovery.
