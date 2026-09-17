import { createHash, sign, verify } from 'node:crypto';

export interface BackupInventory {
  schema_version: '1';
  backup_id: string;
  created_at: string;
  database: {
    pitr_target: string;
    lsn: string;
    schema_version: string;
  };
  artifacts: {
    snapshot_id: string;
    manifest_sha256: string;
    object_count: number;
  };
  application: {
    image_digest: string;
    schema_version: string;
  };
  operator_run_id: string;
  objectives: {
    rpo_minutes: number;
    rto_minutes: number;
  };
}

export interface BackupInventorySigner {
  key_id: string;
  private_key_pem: string;
}

export interface SignedBackupInventory {
  inventory: BackupInventory;
  signature: {
    algorithm: 'ed25519';
    key_id: string;
    signature: string;
  };
}

const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;

/** Parse and validate the redacted, machine-readable recovery inventory. */
export function parseBackupInventory(input: unknown): BackupInventory {
  if (isRecord(input) && ('inventory' in input || 'signature' in input))
    throw new Error('backup inventory envelope keys are reserved');
  if (!isRecord(input) || input.schema_version !== '1')
    throw new Error('backup inventory schema_version must be 1');
  const database = record(input.database, 'database');
  const artifacts = record(input.artifacts, 'artifacts');
  const application = record(input.application, 'application');
  const objectives = record(input.objectives, 'objectives');
  const inventory: BackupInventory = {
    schema_version: '1',
    backup_id: identifier(input.backup_id, 'backup_id'),
    created_at: timestamp(input.created_at, 'created_at'),
    database: {
      pitr_target: timestamp(database.pitr_target, 'database.pitr_target'),
      lsn: lsn(database.lsn),
      schema_version: identifier(database.schema_version, 'database.schema_version'),
    },
    artifacts: {
      snapshot_id: identifier(artifacts.snapshot_id, 'artifacts.snapshot_id'),
      manifest_sha256: digest(artifacts.manifest_sha256, 'artifacts.manifest_sha256'),
      object_count: positiveInteger(artifacts.object_count, 'artifacts.object_count'),
    },
    application: {
      image_digest: imageDigest(application.image_digest),
      schema_version: identifier(application.schema_version, 'application.schema_version'),
    },
    operator_run_id: identifier(input.operator_run_id, 'operator_run_id'),
    objectives: {
      rpo_minutes: positiveInteger(objectives.rpo_minutes, 'objectives.rpo_minutes'),
      rto_minutes: positiveInteger(objectives.rto_minutes, 'objectives.rto_minutes'),
    },
  };
  return inventory;
}

/** Stable JSON representation suitable for signing or storing as evidence. */
export function canonicalBackupInventory(input: unknown): string {
  return `${JSON.stringify(parseBackupInventory(input))}\n`;
}

export function backupInventorySha256(input: unknown): string {
  return createHash('sha256').update(canonicalBackupInventory(input), 'utf8').digest('hex');
}

export function signBackupInventory(
  input: unknown,
  signer: BackupInventorySigner,
): SignedBackupInventory {
  const inventory = parseBackupInventory(input);
  if (!signer.key_id.trim()) throw new Error('backup inventory signer key_id is required');
  return {
    inventory,
    signature: {
      algorithm: 'ed25519',
      key_id: signer.key_id.trim(),
      signature: sign(
        null,
        Buffer.from(canonicalBackupInventory(inventory), 'utf8'),
        signer.private_key_pem,
      ).toString('base64url'),
    },
  };
}

export function verifyBackupInventory(
  signed: unknown,
  trustedPublicKeyPem?: string,
): { ok: boolean; reason?: string } {
  try {
    if (!isRecord(signed) || !isRecord(signed.signature))
      throw new Error('backup inventory signature is missing');
    const inventory = parseBackupInventory(signed.inventory);
    const signature = signed.signature;
    if (signature.algorithm !== 'ed25519')
      throw new Error('unsupported backup inventory signature');
    if (typeof signature.key_id !== 'string' || !signature.key_id.trim())
      throw new Error('backup inventory signature key_id is required');
    if (typeof signature.signature !== 'string' || !signature.signature)
      throw new Error('backup inventory signature value is required');
    if (!trustedPublicKeyPem) throw new Error('backup inventory has no trusted public key');
    const valid = verify(
      null,
      Buffer.from(canonicalBackupInventory(inventory), 'utf8'),
      trustedPublicKeyPem,
      Buffer.from(signature.signature, 'base64url'),
    );
    if (!valid) throw new Error('backup inventory signature mismatch');
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`backup inventory ${label} must be an object`);
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new Error(`backup inventory ${label} must be a bounded identifier`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value)))
    throw new Error(`backup inventory ${label} must be an ISO UTC timestamp`);
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new Error(`backup inventory ${label} must be a lowercase SHA-256 digest`);
  return value;
}

function lsn(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Fa-f0-9]+\/[A-Fa-f0-9]+$/.test(value))
    throw new Error('backup inventory database.lsn must be a PostgreSQL LSN');
  return value;
}

function imageDigest(value: unknown): string {
  if (typeof value !== 'string' || !IMAGE_DIGEST.test(value))
    throw new Error('backup inventory application.image_digest must be a SHA-256 image digest');
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`backup inventory ${label} must be a positive integer`);
  return value;
}
