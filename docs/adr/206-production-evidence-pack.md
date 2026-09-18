# ADR-206: Signed production evidence pack

## Status

Accepted — 2026-09-18

## Context

The repository can enforce configuration boundaries, but it cannot directly
prove that an operator's KMS/Vault, immutable artifact store, PostgreSQL
PITR/WAL, IdP or runner identity controls are live. A checklist in Markdown is
too weak for release automation, while treating environment variables as proof
would be misleading.

## Decision

`@aqa/compliance` defines a bounded `ProductionEvidence` envelope containing
provider references and timestamped boolean observations for key rotation,
artifact versioning/retention, PITR/WAL and OIDC/mTLS/runner rotation. The
envelope is signed with Ed25519 and can be verified against an explicit trust
root. `aqa doctor --production` optionally verifies the path named by
`AQA_PRODUCTION_EVIDENCE_PATH` using
`AQA_PRODUCTION_EVIDENCE_PUBLIC_KEY_PEM`.

The doctor reports a missing pack as a warning, an invalid signature/schema as a
failure, and a valid but incomplete pack as a warning. A complete signed pack
is a configuration/evidence assertion, not a substitute for an independent
provider audit or a live restore/identity exercise.

## Consequences

- Release automation has a machine-readable, tamper-evident handoff from SRE
  and security operations.
- No credentials, connection strings, raw provider responses or customer data
  are accepted by the contract.
- Provider execution and freshness remain deployment responsibilities and must
  be evidenced by the producer of the signed pack.
