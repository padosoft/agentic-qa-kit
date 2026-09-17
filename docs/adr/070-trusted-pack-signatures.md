# ADR-070 — Trusted detached pack signatures

## Status

Accepted — 2026-09-17

## Decision

Pack manifests may declare `signing.key_id` and
`signing.ed25519_signature`. The signature covers `manifestDigest`, which
canonicalizes the manifest after removing all signing metadata. When
`ApiContext.packTrustedKeys` is configured, both JSON and YAML pack import
boundaries require that signature to verify against the operator-managed PEM
allowlist. A legacy `signing.sha256` without a trust-root policy remains an
integrity check only.

## Rationale

Signing metadata must not be included in its own signed message. Separating
the canonical unsigned digest from the detached signature avoids circular
hashing and makes key rotation explicit through `key_id`. The API policy is
opt-in so existing development fixtures do not silently become unverifiable,
while production operators can fail closed before persistence.

## Evidence and limits

Pack-scanner tests cover valid, untrusted and tampered Ed25519 signatures. A
server import journey covers trusted installation and altered-signature
rejection. Keyless Sigstore/cosign bundle parsing, certificate identity
verification, transparency-log inclusion and SBOM attestation remain open
deployment/supply-chain work.
