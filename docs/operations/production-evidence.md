# Production evidence pack

This is the handoff format for controls that AQA cannot prove by itself from a
developer workstation. The producer must collect the observations from the
approved KMS/Vault, artifact store, PostgreSQL, IdP and runner fleet, sign the
JSON envelope with the approved Ed25519 key, and publish the redacted file to
the release workspace.

The pack contains references and booleans only. Never include credentials,
connection strings, private keys, raw provider responses, customer data or
tokens.

## Example redacted payload

```json
{
  "schema_version": "1",
  "evidence_id": "prod-evidence-2026-q3-eu",
  "captured_at": "2026-09-18T10:00:00Z",
  "environment": "prod-eu-1",
  "application_image_digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "controls": {
    "key_custody": {
      "provider": "vault",
      "key_ref": "transit/aqa-audit",
      "rotation_verified": true,
      "observed_at": "2026-09-18T09:00:00Z"
    },
    "artifact_immutability": {
      "provider": "s3-object-lock",
      "store_ref": "aqa-prod-eu-artifacts",
      "versioning_enabled": true,
      "retention_verified": true,
      "observed_at": "2026-09-18T09:05:00Z"
    },
    "database_recovery": {
      "provider": "postgresql",
      "cluster_ref": "aqa-prod-eu-db",
      "pitr_enabled": true,
      "wal_archiving_verified": true,
      "restore_drill_ref": "drill-2026-q3",
      "restore_drill_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "observed_at": "2026-09-18T09:10:00Z"
    },
    "identity": {
      "provider": "corp-idp",
      "oidc_verified": true,
      "mtls_verified": true,
      "runner_rotation_verified": true,
      "observed_at": "2026-09-18T09:15:00Z"
    }
  }
}
```

## CI/doctor handoff

Set these values in the protected release environment:

```text
AQA_PRODUCTION_EVIDENCE_PATH=/run/secrets/aqa/production-evidence.signed.json
AQA_PRODUCTION_EVIDENCE_PUBLIC_KEY_PEM=<public key from the approved trust root>
AQA_PRODUCTION_EVIDENCE_KEY_ID=production-evidence-key-2026
AQA_PRODUCTION_EVIDENCE_MAX_AGE_HOURS=168
AQA_PRODUCTION_DR_INVENTORY_PATH=/run/secrets/aqa/backup-inventory.json
AQA_PRODUCTION_DR_EVIDENCE_PATH=/run/secrets/aqa/restore-drill.json
```

Run `aqa doctor --production`. The result is:

- `pass`: signature, schema, every required control assertion and the configured
  freshness budget verify;
- `warn`: no pack is configured, the freshness policy is missing, or the signed
  pack is structurally valid but incomplete/stale;
- `fail`: the path, JSON, signature, pinned key identity or trust root is invalid.

The same command also checks the effective admin identity boundary. A complete
`AQA_OIDC_*` configuration passes; partial settings and the implicit local
development identity fail closed. If `AQA_OIDC_SESSION_DSN` is absent, the
doctor makes the process-local session state explicit and recommends a shared
PostgreSQL session backend for multi-replica deployments. This is a runtime
configuration check, not live IdP issuance or certificate-rotation evidence.

`AQA_PRODUCTION_EVIDENCE_KEY_ID` is mandatory when a signed production pack is
configured. It must exactly match the signed envelope's `signature.key_id`; the
public key alone is not sufficient to identify the approved signing identity.

`AQA_PRODUCTION_EVIDENCE_MAX_AGE_HOURS` is required for a passing production
check and must be between `1` and `8760`. It compares the signed
`captured_at` timestamp with the doctor clock; it does not contact providers or
replace an independent restore drill, identity exercise or provider audit.

This check proves provenance and completeness of the submitted observation. It
does not contact providers and must be paired with the provider's audit trail,
fresh restore drill and identity/security test evidence before a production
release is approved.

When the two `AQA_PRODUCTION_DR_*_PATH` values are configured, `aqa doctor
--production` adds a fail-closed binding check that revalidates the inventory
and restore drill and compares their canonical digest with the signed
production envelope. The same pinned key identity is applied to signed backup
inventories. If the paths are absent, the check is explicitly reported as a
warning rather than being silently treated as complete. This is a
provenance gate, not provider execution evidence.

## Protected CI handoff

The repository also ships a manual **Production evidence gate** workflow. Set
these GitHub Environment secrets on the protected `production-evidence`
environment before dispatching it:

| Secret | Contents |
| --- | --- |
| `AQA_PRODUCTION_EVIDENCE_JSON` | Signed redacted production envelope |
| `AQA_PRODUCTION_DR_INVENTORY_JSON` | Validated backup inventory |
| `AQA_PRODUCTION_DR_EVIDENCE_JSON` | Measured restore-drill evidence |
| `AQA_PRODUCTION_EVIDENCE_PUBLIC_KEY_PEM` | Approved Ed25519 trust-root key |
| `AQA_PRODUCTION_EVIDENCE_KEY_ID` | Exact approved signing key ID |

The workflow runs `aqa dr release-gate` and removes its temporary files even on
failure. It validates provenance and cross-document binding; it intentionally
does not claim to execute cloud PITR, KMS, WORM, IdP or runner-provider drills.
