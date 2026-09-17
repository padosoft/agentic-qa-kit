# @aqa/artifacts

Redaction-aware artifact storage for logs, screenshots, traces, reports and replay evidence.

`FileArtifactStore` is the local/on-premise implementation. Text and JSON pass through pre-write redaction, binary artifacts require an explicit `putBytes` call, paths are relative and traversal-safe, writes are temporary-file + atomic rename, and every reference carries a SHA-256 digest. The contract is intentionally small so an S3/MinIO adapter can be added without changing callers.

This package is not yet a WORM implementation and does not provide cloud retention, object-lock, encryption-key management or tenant authorization by itself; those belong in the deployment adapter and API boundary.
