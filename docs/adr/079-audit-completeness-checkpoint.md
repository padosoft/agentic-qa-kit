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
- The contract is not yet automatically emitted by every run or persisted to a
  WORM/Object-Lock domain; that integration remains the next slice.
