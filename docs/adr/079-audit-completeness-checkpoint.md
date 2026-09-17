# ADR-079 — Audit completeness checkpoint

## Status

Accepted — 2026-09-17

## Decision

`@aqa/compliance` exposes a checkpoint contract that binds one complete run to
its contiguous sequence range, event count, head hash, and SHA-256 digest of
the canonical event set. Checkpoints can optionally carry an Ed25519 detached
signature under an operator-managed `key_id`. Verification always re-walks the
hash chain before checking completeness or the signature.

## Rationale

A valid prefix of a locally rewriteable hash chain does not prove that later
events were not removed, and a recomputed chain does not prove who attested it.
The checkpoint separates internal chain integrity, completeness, and external
authenticity. The trust key and retention domain remain operator-controlled.

## Evidence and limits

- Compliance tests cover full-chain acceptance, truncation, replacement,
  signature verification, and missing trusted-key rejection.
- `aqa run` now emits `canonical/checkpoint.json` beside the canonical event
  and finding streams and includes its content reference in
  `canonical/manifest.json`.
- The CLI accepts the paired environment variables
  `AQA_AUDIT_CHECKPOINT_KEY_ID` and `AQA_AUDIT_CHECKPOINT_PRIVATE_KEY_PEM` for
  an Ed25519 signature and rejects a partial configuration before execution.
- The checkpoint is not yet persisted to a WORM/Object-Lock domain; external
  retention and independent checkpoint publication remain deployment work.
