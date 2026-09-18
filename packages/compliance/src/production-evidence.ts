import { createHash, sign, verify } from 'node:crypto';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export interface ProductionEvidence {
  schema_version: '1';
  evidence_id: string;
  captured_at: string;
  environment: string;
  application_image_digest: string;
  controls: {
    key_custody: {
      provider: string;
      key_ref: string;
      rotation_verified: boolean;
      observed_at: string;
    };
    artifact_immutability: {
      provider: string;
      store_ref: string;
      versioning_enabled: boolean;
      retention_verified: boolean;
      observed_at: string;
    };
    database_recovery: {
      provider: string;
      cluster_ref: string;
      pitr_enabled: boolean;
      wal_archiving_verified: boolean;
      restore_drill_ref: string;
      observed_at: string;
    };
    identity: {
      provider: string;
      oidc_verified: boolean;
      mtls_verified: boolean;
      runner_rotation_verified: boolean;
      observed_at: string;
    };
  };
}

export interface SignedProductionEvidence {
  evidence: ProductionEvidence;
  signature: {
    algorithm: 'ed25519';
    key_id: string;
    signature: string;
  };
}

export interface ProductionEvidenceSigner {
  key_id: string;
  private_key_pem: string;
}

export interface ProductionEvidenceCompleteness {
  complete: boolean;
  missing: string[];
}

export interface ProductionEvidenceFreshness {
  fresh: boolean;
  age_hours: number;
  max_age_hours: number;
  reason?: 'expired' | 'future-dated';
}

/** Parse provider observations without accepting credentials or arbitrary payloads. */
export function parseProductionEvidence(input: unknown): ProductionEvidence {
  if (isRecord(input) && ('evidence' in input || 'signature' in input))
    throw new Error('production evidence envelope keys are reserved');
  if (!isRecord(input) || input.schema_version !== '1')
    throw new Error('production evidence schema_version must be 1');
  const controls = record(input.controls, 'controls');
  const keyCustody = record(controls.key_custody, 'controls.key_custody');
  const immutability = record(controls.artifact_immutability, 'controls.artifact_immutability');
  const recovery = record(controls.database_recovery, 'controls.database_recovery');
  const identity = record(controls.identity, 'controls.identity');
  exactKeys(
    input,
    [
      'schema_version',
      'evidence_id',
      'captured_at',
      'environment',
      'application_image_digest',
      'controls',
    ],
    'production evidence',
  );
  exactKeys(
    controls,
    ['key_custody', 'artifact_immutability', 'database_recovery', 'identity'],
    'production evidence controls',
  );
  exactKeys(
    keyCustody,
    ['provider', 'key_ref', 'rotation_verified', 'observed_at'],
    'production evidence key_custody',
  );
  exactKeys(
    immutability,
    ['provider', 'store_ref', 'versioning_enabled', 'retention_verified', 'observed_at'],
    'production evidence artifact_immutability',
  );
  exactKeys(
    recovery,
    [
      'provider',
      'cluster_ref',
      'pitr_enabled',
      'wal_archiving_verified',
      'restore_drill_ref',
      'observed_at',
    ],
    'production evidence database_recovery',
  );
  exactKeys(
    identity,
    ['provider', 'oidc_verified', 'mtls_verified', 'runner_rotation_verified', 'observed_at'],
    'production evidence identity',
  );
  return {
    schema_version: '1',
    evidence_id: identifier(input.evidence_id, 'evidence_id'),
    captured_at: timestamp(input.captured_at, 'captured_at'),
    environment: identifier(input.environment, 'environment'),
    application_image_digest: imageDigest(input.application_image_digest),
    controls: {
      key_custody: {
        provider: identifier(keyCustody.provider, 'controls.key_custody.provider'),
        key_ref: identifier(keyCustody.key_ref, 'controls.key_custody.key_ref'),
        rotation_verified: boolean(
          keyCustody.rotation_verified,
          'controls.key_custody.rotation_verified',
        ),
        observed_at: timestamp(keyCustody.observed_at, 'controls.key_custody.observed_at'),
      },
      artifact_immutability: {
        provider: identifier(immutability.provider, 'controls.artifact_immutability.provider'),
        store_ref: identifier(immutability.store_ref, 'controls.artifact_immutability.store_ref'),
        versioning_enabled: boolean(
          immutability.versioning_enabled,
          'controls.artifact_immutability.versioning_enabled',
        ),
        retention_verified: boolean(
          immutability.retention_verified,
          'controls.artifact_immutability.retention_verified',
        ),
        observed_at: timestamp(
          immutability.observed_at,
          'controls.artifact_immutability.observed_at',
        ),
      },
      database_recovery: {
        provider: identifier(recovery.provider, 'controls.database_recovery.provider'),
        cluster_ref: identifier(recovery.cluster_ref, 'controls.database_recovery.cluster_ref'),
        pitr_enabled: boolean(recovery.pitr_enabled, 'controls.database_recovery.pitr_enabled'),
        wal_archiving_verified: boolean(
          recovery.wal_archiving_verified,
          'controls.database_recovery.wal_archiving_verified',
        ),
        restore_drill_ref: identifier(
          recovery.restore_drill_ref,
          'controls.database_recovery.restore_drill_ref',
        ),
        observed_at: timestamp(recovery.observed_at, 'controls.database_recovery.observed_at'),
      },
      identity: {
        provider: identifier(identity.provider, 'controls.identity.provider'),
        oidc_verified: boolean(identity.oidc_verified, 'controls.identity.oidc_verified'),
        mtls_verified: boolean(identity.mtls_verified, 'controls.identity.mtls_verified'),
        runner_rotation_verified: boolean(
          identity.runner_rotation_verified,
          'controls.identity.runner_rotation_verified',
        ),
        observed_at: timestamp(identity.observed_at, 'controls.identity.observed_at'),
      },
    },
  };
}

/** Return missing control assertions; this does not turn a document into live provider proof. */
export function productionEvidenceCompleteness(input: unknown): ProductionEvidenceCompleteness {
  const evidence = parseProductionEvidence(input);
  const missing: string[] = [];
  if (!evidence.controls.key_custody.rotation_verified) missing.push('key_custody.rotation');
  if (!evidence.controls.artifact_immutability.versioning_enabled)
    missing.push('artifacts.versioning');
  if (!evidence.controls.artifact_immutability.retention_verified)
    missing.push('artifacts.retention');
  if (!evidence.controls.database_recovery.pitr_enabled) missing.push('database.pitr');
  if (!evidence.controls.database_recovery.wal_archiving_verified)
    missing.push('database.wal_archiving');
  if (!evidence.controls.identity.oidc_verified) missing.push('identity.oidc');
  if (!evidence.controls.identity.mtls_verified) missing.push('identity.mtls');
  if (!evidence.controls.identity.runner_rotation_verified)
    missing.push('identity.runner_rotation');
  return { complete: missing.length === 0, missing };
}

/**
 * Check the signed observation's declared capture time against an operator
 * supplied freshness budget. This is a temporal policy check only: it does
 * not contact providers or validate their underlying audit trail.
 */
export function productionEvidenceFreshness(
  input: unknown,
  options: { now?: Date; max_age_hours: number },
): ProductionEvidenceFreshness {
  const evidence = parseProductionEvidence(input);
  if (
    !Number.isFinite(options.max_age_hours) ||
    options.max_age_hours <= 0 ||
    options.max_age_hours > 8760
  )
    throw new Error('production evidence max_age_hours must be greater than 0 and at most 8760');
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('production evidence freshness now is invalid');
  const ageHours = (now.getTime() - Date.parse(evidence.captured_at)) / 3_600_000;
  if (ageHours < 0)
    return {
      fresh: false,
      age_hours: ageHours,
      max_age_hours: options.max_age_hours,
      reason: 'future-dated',
    };
  return {
    fresh: ageHours <= options.max_age_hours,
    age_hours: ageHours,
    max_age_hours: options.max_age_hours,
    ...(ageHours > options.max_age_hours ? { reason: 'expired' as const } : {}),
  };
}

export function canonicalProductionEvidence(input: unknown): string {
  return `${JSON.stringify(parseProductionEvidence(input))}\n`;
}

export function productionEvidenceSha256(input: unknown): string {
  return createHash('sha256').update(canonicalProductionEvidence(input), 'utf8').digest('hex');
}

export function signProductionEvidence(
  input: unknown,
  signer: ProductionEvidenceSigner,
): SignedProductionEvidence {
  const evidence = parseProductionEvidence(input);
  if (!IDENTIFIER.test(signer.key_id))
    throw new Error('production evidence signer key_id is invalid');
  return {
    evidence,
    signature: {
      algorithm: 'ed25519',
      key_id: signer.key_id,
      signature: sign(
        null,
        Buffer.from(canonicalProductionEvidence(evidence), 'utf8'),
        signer.private_key_pem,
      ).toString('base64url'),
    },
  };
}

export function verifyProductionEvidence(
  input: unknown,
  trustedPublicKeyPem?: string,
): { ok: boolean; reason?: string; completeness?: ProductionEvidenceCompleteness } {
  try {
    if (!isRecord(input) || !isRecord(input.signature))
      throw new Error('production evidence signature is missing');
    exactKeys(input, ['evidence', 'signature'], 'production evidence envelope');
    const evidence = parseProductionEvidence(input.evidence);
    const signature = input.signature;
    exactKeys(signature, ['algorithm', 'key_id', 'signature'], 'production evidence signature');
    if (signature.algorithm !== 'ed25519')
      throw new Error('unsupported production evidence signature');
    if (typeof signature.key_id !== 'string' || !IDENTIFIER.test(signature.key_id))
      throw new Error('production evidence signature key_id is invalid');
    if (typeof signature.signature !== 'string' || signature.signature.length === 0)
      throw new Error('production evidence signature value is required');
    if (!trustedPublicKeyPem) throw new Error('production evidence has no trusted public key');
    const valid = verify(
      null,
      Buffer.from(canonicalProductionEvidence(evidence), 'utf8'),
      trustedPublicKeyPem,
      Buffer.from(signature.signature, 'base64url'),
    );
    if (!valid) throw new Error('production evidence signature mismatch');
    return { ok: true, completeness: productionEvidenceCompleteness(evidence) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`production evidence ${label} must be an object`);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const allowed = new Set(expected);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0)
    throw new Error(`${label} contains unsupported field(s): ${unexpected.join(', ')}`);
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value))
    throw new Error(`production evidence ${label} must be a bounded identifier`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value)))
    throw new Error(`production evidence ${label} must be an ISO UTC timestamp`);
  return value;
}

function imageDigest(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value))
    throw new Error('production evidence application_image_digest must be a SHA-256 digest');
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`production evidence ${label} must be boolean`);
  return value;
}
