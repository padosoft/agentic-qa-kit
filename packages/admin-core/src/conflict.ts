export interface Snapshot {
  /** Opaque ETag-like marker. The server bumps this on every write. */
  version: string;
  /** Content hash (sha256 hex). */
  content_hash: string;
}

export interface ConflictResult {
  ok: boolean;
  reason: string;
  /** Categorised reason so the UI can render "your edit / server changed / both edits identical". */
  kind: 'no-change' | 'fast-forward' | 'conflict' | 'identical';
}

/**
 * Compare client + server snapshots and decide whether an optimistic write
 * is safe. Rules:
 *
 * - both versions match AND both content hashes match → fast-forward (apply)
 * - client.version === server.version BUT client.content_hash !== server.content_hash
 *   → conflict (the client missed a server update between read and write)
 * - client.content_hash === server.content_hash regardless of version → identical
 *   (nothing to do, just bump the version)
 * - otherwise → conflict
 */
export function detectConflict(client: Snapshot, server: Snapshot): ConflictResult {
  if (client.content_hash === server.content_hash) {
    if (client.version === server.version) {
      return { ok: true, reason: 'no change since read', kind: 'no-change' };
    }
    return { ok: true, reason: 'identical content on different versions', kind: 'identical' };
  }
  if (client.version === server.version) {
    return {
      ok: false,
      reason: 'content_hash differs at the same version — server changed between read and write',
      kind: 'conflict',
    };
  }
  return { ok: false, reason: 'both version and content differ', kind: 'conflict' };
}
