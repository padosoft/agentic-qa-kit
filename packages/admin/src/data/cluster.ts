/**
 * Browser-friendly clustering. Mirrors `@aqa/clustering`'s `signatureOf` /
 * `clusterFindings` shape, with sha256 via Web Crypto. See
 * `src/data/audit.ts` for the rationale (node:crypto is not browser-safe
 * under Vite).
 */
import type { MockFinding } from './mock.ts';

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface Cluster {
  signature: string;
  representative: MockFinding;
  count: number;
  worst_severity: MockFinding['severity'];
  members: MockFinding[];
}

const SEVERITY_RANK: Record<MockFinding['severity'], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export async function signatureOf(f: MockFinding): Promise<string> {
  const normalized = f.summary.toLowerCase().replace(/\s+/g, ' ').trim();
  return sha256Hex(`${f.scenario_id}|${f.risk_id}|${normalized}`);
}

export async function clusterFindings(findings: MockFinding[]): Promise<Cluster[]> {
  const groups = new Map<string, MockFinding[]>();
  for (const f of findings) {
    const sig = await signatureOf(f);
    const arr = groups.get(sig) ?? [];
    arr.push(f);
    groups.set(sig, arr);
  }
  const clusters: Cluster[] = [];
  for (const [signature, members] of groups) {
    const sorted = [...members].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const representative = sorted[0];
    if (!representative) continue;
    const worst = sorted.reduce<MockFinding>(
      (acc, m) => (SEVERITY_RANK[m.severity] > SEVERITY_RANK[acc.severity] ? m : acc),
      representative,
    );
    clusters.push({
      signature,
      representative,
      count: members.length,
      worst_severity: worst.severity,
      members: sorted,
    });
  }
  return clusters.sort((a, b) => SEVERITY_RANK[b.worst_severity] - SEVERITY_RANK[a.worst_severity]);
}
