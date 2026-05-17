import { createHash } from 'node:crypto';
import type { PackManifest } from '@aqa/schemas';

export interface SignatureCheck {
  ok: boolean;
  reason: string;
}

/**
 * v0.3 signature check: hash the canonicalised manifest minus `signing.*`
 * and compare against `signing.sha256`. The cosign / sigstore bundle
 * verification lands with v0.4 once the trust-root file format settles.
 *
 * "Canonical" here means JSON.stringify with sorted object keys — the same
 * canonicaliser used by EventChainWriter.
 */
export function verifySignature(
  manifest: PackManifest.PackManifest,
  rawBody: string,
): SignatureCheck {
  if (!manifest.signing?.sha256) {
    return { ok: false, reason: 'manifest does not declare signing.sha256' };
  }
  const digest = createHash('sha256').update(rawBody).digest('hex');
  if (digest !== manifest.signing.sha256) {
    return {
      ok: false,
      reason: `digest mismatch: computed ${digest.slice(0, 12)}…, declared ${manifest.signing.sha256.slice(0, 12)}…`,
    };
  }
  return { ok: true, reason: 'digest matches declared signing.sha256' };
}
