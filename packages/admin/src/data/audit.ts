/**
 * Browser-friendly hash-chain verifier. Mirrors `@aqa/compliance`'s
 * `verifyEventChain` but uses Web Crypto (`crypto.subtle.digest`) so it can
 * run in the admin SPA bundle — `node:crypto` is not safe to import in
 * Vite browser bundles.
 *
 * Kept intentionally in the admin package: the *operator-facing* compliance
 * verifier (Node CLI) is the source of truth; this in-browser copy is a UX
 * affordance for the audit-log viewer and is not used for SOC2 evidence.
 */

const ZERO_HASH = '0'.repeat(64);

export interface AuditEvent {
  prev_hash: string;
  hash: string;
  [k: string]: unknown;
}

export interface ChainVerifyResult {
  ok: boolean;
  bad_index: number;
  reason?: string;
  count: number;
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`)
    .join(',')}}`;
}

async function sha256Hex(prev: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = new Uint8Array(prev.length + body.length);
  buf.set(enc.encode(prev), 0);
  buf.set(enc.encode(body), prev.length);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyEventChain(events: AuditEvent[]): Promise<ChainVerifyResult> {
  let expectedPrev = ZERO_HASH;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) return { ok: false, bad_index: i, reason: 'empty record', count: events.length };
    if (ev.prev_hash !== expectedPrev) {
      return {
        ok: false,
        bad_index: i,
        reason: `prev_hash mismatch at #${i}`,
        count: events.length,
      };
    }
    const { hash, ...rest } = ev;
    const recomputed = await sha256Hex(expectedPrev, canonicalStringify(rest));
    if (recomputed !== hash) {
      return {
        ok: false,
        bad_index: i,
        reason: `hash mismatch at #${i}`,
        count: events.length,
      };
    }
    expectedPrev = hash;
  }
  return { ok: true, bad_index: -1, count: events.length };
}

export function parseEventLines(text: string): AuditEvent[] {
  const out: AuditEvent[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    out.push(JSON.parse(line) as AuditEvent);
  }
  return out;
}

export async function buildMockChain(): Promise<{ good: string; tampered: string }> {
  const bodies = [
    { kind: 'run.start', run_id: 'run-2026-05-17-b', t: 1715937900 },
    {
      kind: 'scenario.start',
      run_id: 'run-2026-05-17-b',
      scenario_id: 'sc-auth-bypass',
      t: 1715937905,
    },
    { kind: 'finding.emitted', run_id: 'run-2026-05-17-b', finding_id: 'f-001', t: 1715937912 },
    {
      kind: 'scenario.end',
      run_id: 'run-2026-05-17-b',
      scenario_id: 'sc-auth-bypass',
      t: 1715937920,
    },
    { kind: 'run.end', run_id: 'run-2026-05-17-b', t: 1715938212 },
  ];
  let prev = ZERO_HASH;
  const events: AuditEvent[] = [];
  for (const body of bodies) {
    const rest = { prev_hash: prev, ...body };
    const hash = await sha256Hex(prev, canonicalStringify(rest));
    prev = hash;
    events.push({ ...rest, hash });
  }
  const good = events.map((e) => JSON.stringify(e)).join('\n');
  const tampered = events
    .map((e, i) => (i === 2 ? { ...e, kind: 'finding.emitted-EVIL' } : e))
    .map((e) => JSON.stringify(e))
    .join('\n');
  return { good, tampered };
}
