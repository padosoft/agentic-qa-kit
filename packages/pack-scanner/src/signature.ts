import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { PackManifest } from '@aqa/schemas';
import { verify as verifySigstore } from 'sigstore';

export interface SignatureCheck {
  ok: boolean;
  reason: string;
}

export interface SigstoreVerificationPolicy {
  certificate_identity?: string;
  certificate_identity_uri?: string;
  certificate_oidc_issuer?: string;
  tlog_threshold?: number;
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

/** Verify an Ed25519 signature over the canonical unsigned manifest digest. */
export function verifyTrustedManifestSignature(
  manifest: PackManifest.PackManifest,
  trustedKeys: Readonly<Record<string, string>>,
): SignatureCheck {
  const signing = manifest.signing;
  if (!signing?.key_id || !signing.ed25519_signature)
    return { ok: false, reason: 'manifest does not declare key_id and ed25519_signature' };
  const publicKey = trustedKeys[signing.key_id];
  if (!publicKey) return { ok: false, reason: `untrusted pack signing key: ${signing.key_id}` };
  try {
    const valid = verify(
      null,
      Buffer.from(manifestDigest(manifest), 'utf8'),
      createPublicKey(publicKey),
      Buffer.from(signing.ed25519_signature, 'base64url'),
    );
    return valid
      ? { ok: true, reason: `trusted Ed25519 signature verified for key ${signing.key_id}` }
      : { ok: false, reason: 'Ed25519 signature mismatch' };
  } catch {
    return { ok: false, reason: 'invalid Ed25519 public key or signature encoding' };
  }
}

/**
 * Digest every pack file deterministically, excluding YAML presentation of
 * the manifest. The unsigned parsed manifest is included as a virtual file
 * so signing metadata cannot create a recursive digest.
 */
export function packContentDigest(root: string, manifest: PackManifest.PackManifest): string {
  const { signing: _signing, ...unsigned } = manifest;
  const entries = [`pack-manifest.json\0${canonicalStringify(unsigned)}`];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const relativePath = relative(root, absolute).replaceAll('\\', '/');
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`pack contains symlink: ${relativePath}`);
      if (stat.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!stat.isFile()) throw new Error(`pack contains unsupported file: ${relativePath}`);
      if (relativePath === 'pack.yaml' || relativePath === 'pack.yml') continue;
      const digest = createHash('sha256').update(readFileSync(absolute)).digest('hex');
      entries.push(`${relativePath}\0${digest}`);
    }
  };
  walk(root);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

export function verifyPackContentDigest(
  root: string,
  manifest: PackManifest.PackManifest,
): SignatureCheck {
  const declared = manifest.signing?.content_sha256;
  if (!declared) return { ok: true, reason: 'pack content digest is not declared' };
  try {
    const computed = packContentDigest(root, manifest);
    return computed === declared
      ? { ok: true, reason: 'all pack content matches signing.content_sha256' }
      : { ok: false, reason: `pack content digest mismatch: computed ${computed.slice(0, 12)}…` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Verify a serialized Sigstore bundle over the canonical pack payload. */
export async function verifySigstoreBundle(
  manifest: PackManifest.PackManifest,
  policy: SigstoreVerificationPolicy,
): Promise<SignatureCheck> {
  const signing = manifest.signing;
  const encoded = signing?.sigstore_bundle;
  if (!signing || !encoded)
    return { ok: false, reason: 'manifest does not declare signing.sigstore_bundle' };
  if (
    !policy.certificate_oidc_issuer ||
    (!policy.certificate_identity && !policy.certificate_identity_uri)
  )
    return { ok: false, reason: 'Sigstore policy requires certificate identity and OIDC issuer' };
  try {
    const bundleText = decodeBundle(encoded);
    const bundle = JSON.parse(bundleText) as Parameters<typeof verifySigstore>[0];
    const payload = Buffer.from(signing.content_sha256 ?? manifestDigest(manifest), 'utf8');
    const signer = await verifySigstore(bundle, payload, {
      ...(policy.certificate_identity
        ? { certificateIdentityEmail: policy.certificate_identity }
        : {}),
      ...(policy.certificate_identity_uri
        ? { certificateIdentityURI: policy.certificate_identity_uri }
        : {}),
      certificateIssuer: policy.certificate_oidc_issuer,
      tlogThreshold: policy.tlog_threshold ?? 1,
    });
    const identity = signer.identity?.subjectAlternativeName ?? 'certificate identity';
    return { ok: true, reason: `Sigstore bundle verified for ${identity}` };
  } catch (error) {
    return {
      ok: false,
      reason: `Sigstore verification failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function decodeBundle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  if (!decoded.trim().startsWith('{'))
    throw new Error('sigstore bundle is not JSON or base64 JSON');
  return decoded;
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
