# @aqa/artifacts

Redaction-aware artifact storage for logs, screenshots, traces, reports and replay evidence.

`FileArtifactStore` is the local implementation. `S3ArtifactStore` targets AWS S3, MinIO and compatible private-cloud APIs. Text and JSON pass through pre-write redaction, binary artifacts require an explicit `putBytes` call, paths are relative and traversal-safe, and every reference carries a SHA-256 digest. S3 writes can optionally request Object Lock governance/compliance retention and use an authenticated tenant prefix.

The S3 adapter does not create buckets, configure versioning/Object Lock, manage KMS keys or authorize tenants. Operators must enable those bucket controls and derive prefixes from an authenticated tenant at the API boundary. `FileArtifactStore` remains non-WORM and is intended for local/dev use.
