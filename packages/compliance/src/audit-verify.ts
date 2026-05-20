import { createHash } from 'node:crypto';

/**
 * Hash-chain verification for `events.jsonl` audit logs.
 *
 * Each event line is a JSON object containing at minimum:
 *   - `prev_hash`: sha256 of the previous record (or `null` on the
 *     first record)
 *   - `hash`: sha256(prev_hash || canonical(rest)) of the current record
 *
 * `verifyEventChain(lines)` re-walks the chain and returns the index of
 * the first mismatch, or -1 if the chain is intact.
 *
 * Why this exists: SOC2 CC7.1/CC7.2 and ISO A.8.15 ask for tamper-evident
 * logging. A hash chain is mechanically verifiable — auditors do not need
 * to trust runner uptime, just the cryptographic output.
 */

const ZERO_HASH = '0'.repeat(64);

export interface AuditEvent {
  prev_hash: string | null;
  hash: string;
  [k: string]: unknown;
}

export interface ChainVerifyResult {
  ok: boolean;
  /** Index of the first bad record, or -1 if the chain is intact. */
  bad_index: number;
  /** Reason for failure, when `ok=false`. */
  reason?: string;
  /** Total records walked. */
  count: number;
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',')}}`;
}

function computeHash(prevHash: string, rest: Record<string, unknown>): string {
  return createHash('sha256').update(prevHash).update(canonicalStringify(rest)).digest('hex');
}

export function verifyEventChain(events: AuditEvent[]): ChainVerifyResult {
  let expectedPrev = ZERO_HASH;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) {
      return { ok: false, bad_index: i, reason: 'empty record', count: events.length };
    }
    const expectedField = i === 0 ? null : expectedPrev;
    if (ev.prev_hash !== expectedField) {
      return {
        ok: false,
        bad_index: i,
        reason: `prev_hash mismatch (expected ${String(expectedField).slice(0, 12)}…, got ${String(ev.prev_hash).slice(0, 12)}…)`,
        count: events.length,
      };
    }
    const { hash, prev_hash: _prevHash, ...rest } = ev;
    const recomputed = computeHash(expectedPrev, rest);
    if (recomputed !== hash) {
      return {
        ok: false,
        bad_index: i,
        reason: `hash mismatch (expected ${recomputed.slice(0, 12)}…, got ${String(hash).slice(0, 12)}…)`,
        count: events.length,
      };
    }
    expectedPrev = hash;
  }
  return { ok: true, bad_index: -1, count: events.length };
}

export function parseEventLines(text: string): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    events.push(JSON.parse(line) as AuditEvent);
  }
  return events;
}
