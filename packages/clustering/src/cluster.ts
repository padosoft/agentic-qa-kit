import { createHash } from 'node:crypto';
import type { Finding } from '@aqa/schemas';

export type Signature = string;

export interface Cluster {
  signature: Signature;
  /** Stable local root-cause key. Semantic similarity is never inferred. */
  root_cause_id: string;
  /** Findings ordered by discovered_at ascending. */
  members: ReadonlyArray<Finding.Finding>;
  representative: Finding.Finding;
  /** Highest severity seen across the cluster. */
  severity: Finding.Finding['severity'];
  /** Explainable severity × confidence × blast-radius / fix-cost score. */
  priority_score: number;
}

const SEV_RANK: Record<Finding.Finding['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEV_WEIGHT: Record<Finding.Finding['severity'], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

/**
 * Compute a cross-run signature for a finding. The signature is sha256 of
 * `(scenario_id, risk_id, normalised_summary)` where normalised_summary
 * lowercases + strips numbers/punctuation so the same bug repro'd in two
 * runs with different IDs collapses.
 */
export function signatureOf(f: Finding.Finding): Signature {
  const normalised = f.summary
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(`${f.scenario_id}|${f.risk_id}|${normalised}`).digest('hex');
}

export function rootCauseId(signature: Signature): string {
  return `root-${signature.slice(0, 24)}`;
}

export function priorityOf(finding: Finding.Finding): number {
  const blastRadius = finding.blast_radius ?? 1;
  const cost = finding.cost_to_fix_estimate ?? 1;
  return Number(
    ((SEV_WEIGHT[finding.severity] * finding.confidence * blastRadius) / cost).toFixed(6),
  );
}

function worseSeverity(
  a: Finding.Finding['severity'],
  b: Finding.Finding['severity'],
): Finding.Finding['severity'] {
  return SEV_RANK[a] <= SEV_RANK[b] ? a : b;
}

/**
 * Group findings by signature. Within a cluster, members are ordered by
 * discovered_at; the representative is the earliest with the worst severity.
 */
export function clusterFindings(findings: ReadonlyArray<Finding.Finding>): ReadonlyArray<Cluster> {
  const groups = new Map<Signature, Finding.Finding[]>();
  for (const f of findings) {
    const sig = signatureOf(f);
    const bucket = groups.get(sig) ?? [];
    bucket.push(f);
    groups.set(sig, bucket);
  }
  const out: Cluster[] = [];
  for (const [signature, members] of groups) {
    members.sort((a, b) => (a.discovered_at < b.discovered_at ? -1 : 1));
    const representative = members[0];
    if (!representative) continue;
    let worst: Finding.Finding['severity'] = representative.severity;
    for (const m of members) worst = worseSeverity(worst, m.severity);
    const priority_score = Math.max(...members.map(priorityOf));
    out.push({
      signature,
      root_cause_id: representative.root_cause_id ?? rootCauseId(signature),
      members,
      representative,
      severity: worst,
      priority_score,
    });
  }
  out.sort(
    (a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.priority_score - a.priority_score,
  );
  return out;
}
