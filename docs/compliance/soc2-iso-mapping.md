# SOC2 / ISO 27001 controls mapping

> Source of truth for auditors. Each row says "we satisfy criterion X via
> capability Y, packaged in Z, with evidence E". The canonical machine-
> readable form is `CONTROL_MAPPINGS` in `@aqa/compliance`.

## How to use this document

1. **Auditor view.** Read the table below to see which SOC2 TSC criteria
   and ISO 27001:2022 Annex A controls are anchored to shipped features.
2. **Evidence collection.** For each control, the "Evidence" column states
   what artifact proves it (audit log, signature manifest, etc.). The
   `aqa-audit-verify` CLI mechanically validates the hash-chained log.
3. **Coverage gap.** Run `import { controlsCoverage } from '@aqa/compliance'`
   in a node REPL to get the full coverage summary.

## Catalog

| Feature | Packages | SOC2 TSC | ISO 27001:2022 | Evidence |
|---|---|---|---|---|
| Hash-chained audit log | `@aqa/runner`, `@aqa/compliance` | CC7.1, CC7.2, CC7.3 | A.8.15, A.8.16, A.8.24 | `aqa-audit-verify` re-walks chain |
| SSO/OIDC + RBAC | `@aqa/auth` | CC6.1, CC6.2, CC6.3 | A.5.15, A.5.17, A.8.2, A.8.5 | `allows()` is the sole access gate |
| Pack signing + scanning | `@aqa/pack-scanner`, `@aqa/pack-loader` | CC6.8, CC8.1 | A.8.24, A.8.28, A.8.32 | `scanPack` rejects unsigned ≥1.0 |
| Container sandbox default | `@aqa/sandbox`, `@aqa/runner` | CC6.6, CC6.8 | A.8.24, A.8.28 | Network/resource caps at sandbox |
| STRIDE/FMEA/OWASP mapping | `@aqa/methodology` | CC5.1 | A.5.23 | `methodologyCheck` flags orphans |
| Cost governance hard cap | `@aqa/cost` | CC7.4 | A.5.30 | Per-tenant USD budget enforced |
| Determinism + 3-level replay | `@aqa/runner`, `@aqa/reporter` | CC8.1 | A.8.32 | Repro artifacts per finding |

## What v1.0 does NOT cover

- **CC9.x (Risk Mitigation — vendor management).** Customer-side process.
- **Pen-test cadence.** See `docs/compliance/pen-test-scope.md` — scope &
  cadence shipped; the test itself is a customer engagement.
- **Automated evidence collection.** Roadmap for v1.1 — auto-capture
  artifacts per control into a tamper-evident bundle.
