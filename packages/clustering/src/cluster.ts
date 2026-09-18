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

export interface SemanticSimilarityEdge {
  left_id: string;
  right_id: string;
  score: number;
  method: 'token' | 'embedding';
}

export interface SemanticCluster extends Cluster {
  /** Explicit candidate links that caused members to be grouped. */
  similarity_edges: ReadonlyArray<SemanticSimilarityEdge>;
}

export interface SemanticClusteringOptions {
  /** Similarity must be at least this value; default is intentionally conservative. */
  threshold?: number;
  /** Optional operator-owned embedding function. Raw vectors are never persisted. */
  embed?: (finding: Finding.Finding) => ReadonlyArray<number>;
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

function tokens(finding: Finding.Finding): Set<string> {
  const text = [finding.title, finding.summary, ...finding.tags]
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/gu, ' ');
  return new Set(text.split(/\s+/u).filter((token) => token.length >= 3));
}

function tokenSimilarity(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / union.size;
}

function cosineSimilarity(left: ReadonlyArray<number>, right: ReadonlyArray<number>): number {
  if (left.length === 0 || left.length !== right.length || left.length > 4_096)
    throw new Error('semantic embedding vectors must have the same bounded non-zero dimension');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b))
      throw new Error('semantic embedding vectors must contain finite numbers');
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

/**
 * Group findings with an explicit, bounded similarity edge in addition to
 * exact fingerprints. Only findings for the same risk are eligible, and
 * connected components are returned with the links that explain each merge.
 * The default token score is deterministic; an embedding provider is opt-in.
 */
export function clusterFindingsBySimilarity(
  findings: ReadonlyArray<Finding.Finding>,
  options: SemanticClusteringOptions = {},
): ReadonlyArray<SemanticCluster> {
  const threshold = options.threshold ?? 0.82;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error('semantic clustering threshold must be between 0 and 1');
  if (findings.length > 10_000) throw new Error('semantic clustering is limited to 10000 findings');

  const parent = findings.map((_, index) => index);
  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root] as number;
    let index = start;
    while (parent[index] !== index) {
      const next = parent[index] as number;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const edges: SemanticSimilarityEdge[] = [];
  const tokenSets = options.embed ? undefined : findings.map(tokens);
  const allVectors = options.embed
    ? findings.map((finding) => options.embed?.(finding) ?? [])
    : undefined;
  if (allVectors) {
    for (const vector of allVectors) {
      if (vector.length === 0 || vector.length > 4_096)
        throw new Error('semantic embedding vectors must have the same bounded non-zero dimension');
      for (const value of vector) {
        if (!Number.isFinite(value))
          throw new Error('semantic embedding vectors must contain finite numbers');
      }
    }
  }
  for (let left = 0; left < findings.length; left += 1) {
    const leftFinding = findings[left];
    if (!leftFinding) continue;
    for (let right = left + 1; right < findings.length; right += 1) {
      const rightFinding = findings[right];
      if (!rightFinding || leftFinding.risk_id !== rightFinding.risk_id) continue;
      const score = options.embed
        ? cosineSimilarity(allVectors?.[left] ?? [], allVectors?.[right] ?? [])
        : tokenSimilarity(tokenSets?.[left] ?? new Set(), tokenSets?.[right] ?? new Set());
      if (score < threshold) continue;
      edges.push({
        left_id: leftFinding.id,
        right_id: rightFinding.id,
        score: Number(score.toFixed(6)),
        method: options.embed ? 'embedding' : 'token',
      });
      union(left, right);
    }
  }
  const groups = new Map<number, Finding.Finding[]>();
  findings.forEach((finding, index) => {
    const bucket = groups.get(find(index)) ?? [];
    bucket.push(finding);
    groups.set(find(index), bucket);
  });
  return [...groups.values()]
    .map((members) => {
      const exact = clusterFindings([members[0] as Finding.Finding])[0];
      if (!exact) throw new Error('semantic clustering produced an empty group');
      const ids = new Set(members.map((member) => member.id));
      const ordered = [...members].sort((a, b) =>
        a.discovered_at < b.discovered_at ? -1 : a.discovered_at > b.discovered_at ? 1 : 0,
      );
      const worst = ordered.reduce(
        (severity, member) => worseSeverity(severity, member.severity),
        ordered[0]?.severity ?? exact.severity,
      );
      return {
        ...exact,
        members: ordered,
        representative: ordered[0] ?? exact.representative,
        severity: worst,
        priority_score: Math.max(...ordered.map(priorityOf)),
        similarity_edges: edges.filter((edge) => ids.has(edge.left_id) && ids.has(edge.right_id)),
      };
    })
    .sort(
      (a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.priority_score - a.priority_score,
    );
}
