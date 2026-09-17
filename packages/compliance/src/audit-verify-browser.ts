import { canonicalStringify } from './audit-canonical.js';

const ZERO_HASH = '0'.repeat(64);

export interface BrowserAuditEvent {
  prev_hash: string | null;
  hash: string;
  [key: string]: unknown;
}

export interface BrowserChainVerifyResult {
  ok: boolean;
  bad_index: number;
  reason?: string;
  count: number;
}

/** WebCrypto-only verifier for the admin bundle; no Node crypto dependency. */
export async function verifyEventChainBrowser(
  events: readonly BrowserAuditEvent[],
  upto = events.length,
): Promise<BrowserChainVerifyResult> {
  const count = Math.max(0, Math.min(upto, events.length));
  let expectedPrev = ZERO_HASH;
  for (let i = 0; i < count; i += 1) {
    const event = events[i];
    if (!event) return { ok: false, bad_index: i, reason: 'empty record', count };
    const expectedField = i === 0 ? null : expectedPrev;
    if (event.prev_hash !== expectedField)
      return { ok: false, bad_index: i, reason: 'prev_hash mismatch', count };
    const { hash, prev_hash: _prevHash, ...rest } = event;
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(expectedPrev + canonicalStringify(rest)),
    );
    const recomputed = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    if (recomputed !== hash) return { ok: false, bad_index: i, reason: 'hash mismatch', count };
    expectedPrev = hash;
  }
  return { ok: true, bad_index: -1, count };
}
