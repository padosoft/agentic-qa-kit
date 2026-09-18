# ADR-233: Pin signed production evidence to an explicit key identity

## Status

Accepted

## Context

Signed production evidence already verifies its Ed25519 signature against an
operator-supplied public key. A public key proves cryptographic possession, but
does not by itself prove that the envelope's declared `signature.key_id` is the
identity approved by the release policy. Without that binding, key rotation and
trust-root configuration can become ambiguous, especially when the same public
key is reused across environments or when signed backup inventories are joined
to production evidence.

## Decision

The compliance verifiers accept an optional expected key ID and fail closed when
the signed envelope declares a different ID. Production-facing paths make the
identity mandatory:

- `aqa dr release-gate` requires `--public-key-id`;
- `aqa doctor --production` requires `AQA_PRODUCTION_EVIDENCE_KEY_ID` when a
  signed production pack is configured;
- the restore-binding check applies the same pinned identity to signed backup
  inventories and production evidence.

The key ID is an exact, non-secret identifier. It is not a substitute for
signature verification, key rotation procedures, revocation, or a separately
managed trust root. Provider-backed KMS/HSM and external trust-root retrieval
remain follow-up work.

## Consequences

Key rotation becomes explicit and reviewable: operators update the approved
public key and its matching key ID together. Legacy callers of the library
remain compatible because the verifier argument is optional; production CLI and
doctor policy are intentionally stricter.
