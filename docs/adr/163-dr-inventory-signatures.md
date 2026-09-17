# ADR-163: Sign DR inventory evidence with an explicit trust root

## Status

Accepted

## Context

The backup inventory contract is canonical and hashable, but a digest alone
cannot identify who attested the recovery set.

## Decision

`@aqa/compliance` exposes Ed25519 `signBackupInventory` and
`verifyBackupInventory`. The signature covers only the canonical parsed
inventory. Verification requires the `ed25519` algorithm, a non-empty key ID,
the signature value and an explicitly supplied trusted public key. Missing
trust roots and any payload mutation fail closed.

## Evidence and boundary

The compliance suite passes 13/13 locally. Private-key custody, KMS/Vault
integration, trust-map distribution and rotation remain operator/infrastructure
responsibilities and are not claimed by this library.
