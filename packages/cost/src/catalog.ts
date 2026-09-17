import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import type { ModelPricing } from './pricing.js';

export interface PricingCatalog {
  schema_version: '1';
  version: string;
  effective_at: string;
  models: Readonly<Record<string, ModelPricing>>;
  sha256: string;
}

export type SignedPricingCatalog = PricingCatalog & {
  signing: {
    algorithm: 'Ed25519';
    key_id: string;
    signature: string;
  };
};

/** Parse and hash a deterministic pricing catalog before it reaches a tracker. */
export function parsePricingCatalog(input: unknown): PricingCatalog {
  if (!input || typeof input !== 'object')
    throw new Error('[cost] pricing catalog must be an object');
  const raw = input as Record<string, unknown>;
  if (
    raw.schema_version !== '1' ||
    typeof raw.version !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw.version)
  )
    throw new Error('[cost] pricing catalog schema_version/version are required');
  if (
    typeof raw.effective_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw.effective_at) ||
    Number.isNaN(Date.parse(raw.effective_at))
  )
    throw new Error('[cost] pricing catalog effective_at must be an ISO UTC timestamp');
  if (!raw.models || typeof raw.models !== 'object' || Array.isArray(raw.models))
    throw new Error('[cost] pricing catalog models must be an object');
  const models: Record<string, ModelPricing> = {};
  for (const [model, value] of Object.entries(raw.models as Record<string, unknown>)) {
    if (!model.trim()) throw new Error('[cost] pricing catalog model name is required');
    if (!value || typeof value !== 'object') throw new Error(`[cost] invalid pricing for ${model}`);
    const price = value as Record<string, unknown>;
    if (
      typeof price.input_per_mtok !== 'number' ||
      !Number.isFinite(price.input_per_mtok) ||
      price.input_per_mtok < 0 ||
      typeof price.output_per_mtok !== 'number' ||
      !Number.isFinite(price.output_per_mtok) ||
      price.output_per_mtok < 0
    )
      throw new Error(`[cost] invalid pricing for ${model}`);
    models[model] = {
      input_per_mtok: price.input_per_mtok,
      output_per_mtok: price.output_per_mtok,
    };
  }
  const canonical = JSON.stringify({
    schema_version: '1',
    version: raw.version,
    effective_at: raw.effective_at,
    models: sortModels(models),
  });
  const sha256 = createHash('sha256').update(canonical).digest('hex');
  if (raw.sha256 !== undefined && raw.sha256 !== sha256)
    throw new Error('[cost] pricing catalog sha256 mismatch');
  return {
    schema_version: '1',
    version: raw.version,
    effective_at: raw.effective_at,
    models: sortModels(models),
    sha256,
  };
}

/** Sign the canonical catalog bytes with an operator-held Ed25519 private key. */
export function signPricingCatalog(
  catalog: PricingCatalog,
  privateKeyPem: string,
  keyId: string,
): SignedPricingCatalog {
  if (!privateKeyPem.trim() || !keyId.trim())
    throw new Error('[cost] pricing catalog signing key and key_id are required');
  const parsed = parsePricingCatalog(catalog);
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error('[cost] pricing catalog signing key must be Ed25519');
  const signature = sign(null, Buffer.from(canonicalBytes(parsed)), key).toString('base64url');
  return {
    ...parsed,
    signing: { algorithm: 'Ed25519', key_id: keyId, signature },
  };
}

/** Verify an operator-signed catalog before it is accepted by budget control. */
export function verifySignedPricingCatalog(
  input: unknown,
  trustedPublicKeys: Readonly<Record<string, string>>,
): SignedPricingCatalog {
  const parsed = parsePricingCatalog(input);
  if (!input || typeof input !== 'object')
    throw new Error('[cost] pricing catalog signing is required');
  const signing = (input as Record<string, unknown>).signing;
  if (!signing || typeof signing !== 'object' || Array.isArray(signing))
    throw new Error('[cost] pricing catalog signing is required');
  const metadata = signing as Record<string, unknown>;
  if (
    metadata.algorithm !== 'Ed25519' ||
    typeof metadata.key_id !== 'string' ||
    !metadata.key_id.trim() ||
    typeof metadata.signature !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(metadata.signature)
  )
    throw new Error('[cost] invalid pricing catalog signature metadata');
  const publicKeyPem = trustedPublicKeys[metadata.key_id];
  if (!publicKeyPem?.trim()) throw new Error('[cost] pricing catalog signer is not trusted');
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error('[cost] pricing catalog trust key must be Ed25519');
  const valid = verify(
    null,
    Buffer.from(canonicalBytes(parsed)),
    key,
    Buffer.from(metadata.signature, 'base64url'),
  );
  if (!valid) throw new Error('[cost] pricing catalog signature mismatch');
  return {
    ...parsed,
    signing: {
      algorithm: 'Ed25519',
      key_id: metadata.key_id,
      signature: metadata.signature,
    },
  };
}

function canonicalBytes(catalog: PricingCatalog): string {
  return JSON.stringify({
    schema_version: catalog.schema_version,
    version: catalog.version,
    effective_at: catalog.effective_at,
    models: sortModels({ ...catalog.models }),
  });
}

function sortModels(models: Record<string, ModelPricing>): Record<string, ModelPricing> {
  return Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b)));
}
