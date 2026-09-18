# ADR-237 — Bind independent checkpoint publication to canonical bytes

## Decision

When `aqa run` publishes a completeness checkpoint to an independently
administered artifact store, it must compare the external artifact reference's
SHA-256 and byte count with the canonical checkpoint reference produced by the
run store. A mismatch fails the run before the canonical manifest is published.

## Rationale

The independent store is an attestation boundary, not merely a second upload
destination. A provider or adapter that redacts, transforms, truncates or
otherwise changes the checkpoint must not be represented as attesting the same
bytes. This check proves content identity between the two references; it does
not prove the external bucket's IAM, Object Lock, versioning, KMS or independent
administration, which remain deployment evidence.
