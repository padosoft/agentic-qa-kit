/**
 * SOC2 / ISO 27001 controls catalog mapping — Task 23.
 *
 * This module maps `agentic-qa-kit` features to the specific SOC2 Trust
 * Service Criteria (TSC) and ISO 27001:2022 Annex A controls they satisfy.
 * Auditors should be able to point at a feature and see "this is how we
 * meet CC6.1" or "this is our evidence for A.8.16".
 *
 * v1.0 ships the mapping table + a `controlsCoverage()` summarizer. The
 * evidence-collection automation (auto-capturing artifacts per control)
 * lands post-v1.0.
 */

export type SocTsc =
  | 'CC1.1' // Control Environment — integrity / values
  | 'CC2.1' // Communication — internal info
  | 'CC5.1' // Risk Mitigation — risk identification
  | 'CC6.1' // Logical Access — access controls
  | 'CC6.2' // Logical Access — registration / authorization
  | 'CC6.3' // Logical Access — modifications
  | 'CC6.6' // Logical Access — network boundary protection
  | 'CC6.7' // Logical Access — restricted transmission
  | 'CC6.8' // Logical Access — malicious software prevention
  | 'CC7.1' // System Operations — monitoring
  | 'CC7.2' // System Operations — anomaly detection
  | 'CC7.3' // System Operations — security events
  | 'CC7.4' // System Operations — incident response
  | 'CC8.1'; // Change Management

export type IsoAnnexA =
  | 'A.5.15' // Access control policy
  | 'A.5.17' // Authentication information
  | 'A.5.23' // Information security for cloud services
  | 'A.5.30' // ICT readiness for business continuity
  | 'A.8.2' // Privileged access rights
  | 'A.8.5' // Secure authentication
  | 'A.8.15' // Logging
  | 'A.8.16' // Monitoring activities
  | 'A.8.24' // Use of cryptography
  | 'A.8.28' // Secure coding
  | 'A.8.32'; // Change management

export interface ControlMapping {
  /** Feature / capability shipped by agentic-qa-kit. */
  feature: string;
  /** Package(s) implementing it. */
  packages: string[];
  /** SOC2 TSC criteria this feature contributes evidence toward. */
  soc2: SocTsc[];
  /** ISO 27001:2022 Annex A controls. */
  iso27001: IsoAnnexA[];
  /** Short prose — what we tell the auditor. */
  evidence: string;
}

export const CONTROL_MAPPINGS: ControlMapping[] = [
  {
    feature: 'Hash-chained audit log (`events.jsonl`)',
    packages: ['@aqa/runner', '@aqa/compliance'],
    soc2: ['CC7.1', 'CC7.2', 'CC7.3'],
    iso27001: ['A.8.15', 'A.8.16', 'A.8.24'],
    evidence:
      'Every runner emits sha256(prev_hash || canonical(rest)) per event. ' +
      '`aqa-audit-verify` re-walks the chain and rejects on mismatch — ' +
      'tamper-evidence is mechanically verifiable.',
  },
  {
    feature: 'SSO/OIDC + RBAC (User/Role/Permission)',
    packages: ['@aqa/auth'],
    soc2: ['CC6.1', 'CC6.2', 'CC6.3'],
    iso27001: ['A.5.15', 'A.5.17', 'A.8.2', 'A.8.5'],
    evidence:
      '`allows(user, action, resource)` is the only access gate. Role ' +
      'assignments are logged through the same hash-chained audit.',
  },
  {
    feature: 'Pack signing + scanning',
    packages: ['@aqa/pack-scanner', '@aqa/pack-loader'],
    soc2: ['CC6.8', 'CC8.1'],
    iso27001: ['A.8.24', 'A.8.28', 'A.8.32'],
    evidence:
      'Packs >=1.0 must be signed; unsigned/always-on-shell packs are ' +
      'rejected by `scanPack` before load. Signature verification uses ' +
      'cosign-compatible key material.',
  },
  {
    feature: 'Container sandbox by default',
    packages: ['@aqa/sandbox', '@aqa/runner'],
    soc2: ['CC6.6', 'CC6.8'],
    iso27001: ['A.8.24', 'A.8.28'],
    evidence:
      'Probes run in `ContainerSandbox` unless explicitly opted out. ' +
      'Network policy + resource caps enforced at the sandbox boundary.',
  },
  {
    feature: 'STRIDE / FMEA / OWASP risk mapping',
    packages: ['@aqa/methodology'],
    soc2: ['CC5.1'],
    iso27001: ['A.5.23'],
    evidence:
      '`methodologyCheck()` flags risks without any standard-framework ' +
      'anchor. Auditors can trace every risk back to STRIDE or OWASP.',
  },
  {
    feature: 'Cost governance hard cap',
    packages: ['@aqa/cost'],
    soc2: ['CC7.4'],
    iso27001: ['A.5.30'],
    evidence:
      'Per-tenant monthly USD budget enforced at request time. Server ' +
      'refuses to start with budget=0 — fail-safe default.',
  },
  {
    feature: 'Determinism contract + 3-level replay',
    packages: ['@aqa/runner', '@aqa/reporter'],
    soc2: ['CC8.1'],
    iso27001: ['A.8.32'],
    evidence:
      'Every finding ships `repro.sh` / `repro.curl` / `repro.playwright.ts`. ' +
      'L3 reproducibility (same bytes) is required for findings tagged ' +
      '`verification_floor: high`.',
  },
];

export interface ControlsCoverage {
  soc2_covered: SocTsc[];
  iso27001_covered: IsoAnnexA[];
  /** Number of mappings contributing evidence to each criterion. */
  soc2_evidence_count: Record<string, number>;
  iso27001_evidence_count: Record<string, number>;
}

/**
 * Summarize which SOC2 / ISO controls have at least one feature mapping.
 * Auditors use this to spot coverage gaps before formal assessment.
 */
export function controlsCoverage(mappings: ControlMapping[] = CONTROL_MAPPINGS): ControlsCoverage {
  const soc2Set = new Set<SocTsc>();
  const isoSet = new Set<IsoAnnexA>();
  const socCount: Record<string, number> = {};
  const isoCount: Record<string, number> = {};

  for (const m of mappings) {
    for (const c of m.soc2) {
      soc2Set.add(c);
      socCount[c] = (socCount[c] ?? 0) + 1;
    }
    for (const c of m.iso27001) {
      isoSet.add(c);
      isoCount[c] = (isoCount[c] ?? 0) + 1;
    }
  }

  return {
    soc2_covered: [...soc2Set].sort(),
    iso27001_covered: [...isoSet].sort(),
    soc2_evidence_count: socCount,
    iso27001_evidence_count: isoCount,
  };
}
