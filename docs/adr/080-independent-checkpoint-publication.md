# ADR-080 — Independent audit checkpoint publication

## Status

Accepted — 2026-09-17

## Decision

`aqa run` accepts an optional `auditCheckpointStore` that is distinct from the
run artifact store. After the canonical checkpoint is created, the same bytes
are published as `checkpoints/<run_id>.json` to that independent store. The
canonical manifest records the external key, content identifier, SHA-256 and
byte count. A publication failure makes the run fail rather than presenting a
locally complete but externally unattested result.

## Rationale

A checkpoint stored only beside the events it attests can be deleted or
rewritten with the same authority as the run itself. A separate store creates a
provider-neutral boundary for an independently administered WORM bucket,
append-only log or compliance archive without coupling the runner to one cloud.

## Limits

The library contract does not provision or prove the external store's IAM,
Object Lock, versioning, KMS, backup or independent administration. Production
bootstrap must inject a separately configured store and provide restore-drill
evidence. The local file-store test proves separation of stores, not durable
immutability.
