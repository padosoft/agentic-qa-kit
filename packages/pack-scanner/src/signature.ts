import { createHash } from 'node:crypto';
import type { PackManifest } from '@aqa/schemas';

export interface SignatureCheck {
  ok: boolean;
  reason: string;
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(object[key])}`)
    .join(',')}}`;
}

/** Digest used by the parsed JSON API, where the original YAML bytes are gone. */
export function manifestDigest(manifest: PackManifest.PackManifest): string {
  const { signing: _signing, ...unsigned } = manifest;
  return createHash('sha256').update(canonicalStringify(unsigned)).digest('hex');
}

export function verifyManifestDigest(manifest: PackManifest.PackManifest): SignatureCheck {
  if (!manifest.signing?.sha256)
    return { ok: false, reason: 'manifest does not declare signing.sha256' };
  const digest = manifestDigest(manifest);
  if (digest !== manifest.signing.sha256) {
    return {
      ok: false,
      reason: `digest mismatch: computed ${digest.slice(0, 12)}…, declared ${manifest.signing.sha256.slice(0, 12)}…`,
    };
  }
  return { ok: true, reason: 'canonical manifest digest matches declared signing.sha256' };
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
