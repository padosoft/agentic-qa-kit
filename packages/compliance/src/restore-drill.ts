import { createHash } from 'node:crypto';
import { type BackupInventory, parseBackupInventory } from './dr-manifest.js';

export interface RestoreDrillEvidence {
  schema_version: '1';
  drill_id: string;
  source_backup_id: string;
  source_manifest_sha256: string;
  restored_manifest_sha256: string;
  target_environment: string;
  started_at: string;
  completed_at: string;
  observed_rpo_minutes: number;
  observed_rto_minutes: number;
  checks: {
    tenant_isolation: boolean;
    audit_chain: boolean;
    queue_fencing: boolean;
    secret_redaction: boolean;
  };
}

/**
 * Validate a restore drill against the backup inventory's identity and
 * approved recovery objectives. A valid result is necessary evidence, but it
 * is only truthful when the caller populated it from a real recovery run.
 */
export function assertRestoreDrillEvidence(
  input: unknown,
  inventoryInput: unknown,
): RestoreDrillEvidence {
  const inventory = parseBackupInventory(inventoryInput);
  if (!isRecord(input) || input.schema_version !== '1')
    throw new Error('restore drill schema_version must be 1');
  const checks = record(input.checks, 'checks');
  exactKeys(
    input,
    [
      'schema_version',
      'drill_id',
      'source_backup_id',
      'source_manifest_sha256',
      'restored_manifest_sha256',
      'target_environment',
      'started_at',
      'completed_at',
      'observed_rpo_minutes',
      'observed_rto_minutes',
      'checks',
    ],
    'restore drill',
  );
  exactKeys(
    checks,
    ['tenant_isolation', 'audit_chain', 'queue_fencing', 'secret_redaction'],
    'restore drill checks',
  );
  const evidence: RestoreDrillEvidence = {
    schema_version: '1',
    drill_id: identifier(input.drill_id, 'drill_id'),
    source_backup_id: identifier(input.source_backup_id, 'source_backup_id'),
    source_manifest_sha256: digest(input.source_manifest_sha256, 'source_manifest_sha256'),
    restored_manifest_sha256: digest(input.restored_manifest_sha256, 'restored_manifest_sha256'),
    target_environment: identifier(input.target_environment, 'target_environment'),
    started_at: timestamp(input.started_at, 'started_at'),
    completed_at: timestamp(input.completed_at, 'completed_at'),
    observed_rpo_minutes: nonNegativeInteger(input.observed_rpo_minutes, 'observed_rpo_minutes'),
    observed_rto_minutes: positiveInteger(input.observed_rto_minutes, 'observed_rto_minutes'),
    checks: {
      tenant_isolation: boolean(checks.tenant_isolation, 'checks.tenant_isolation'),
      audit_chain: boolean(checks.audit_chain, 'checks.audit_chain'),
      queue_fencing: boolean(checks.queue_fencing, 'checks.queue_fencing'),
      secret_redaction: boolean(checks.secret_redaction, 'checks.secret_redaction'),
    },
  };
  if (evidence.source_backup_id !== inventory.backup_id)
    throw new Error('restore drill source backup does not match inventory');
  if (evidence.source_manifest_sha256 !== inventory.artifacts.manifest_sha256)
    throw new Error('restore drill source manifest does not match inventory');
  if (evidence.restored_manifest_sha256 !== evidence.source_manifest_sha256)
    throw new Error('restore drill artifact manifest changed during restore');
  if (Date.parse(evidence.completed_at) <= Date.parse(evidence.started_at))
    throw new Error('restore drill completed_at must be after started_at');
  const elapsedRtoMinutes = Math.ceil(
    (Date.parse(evidence.completed_at) - Date.parse(evidence.started_at)) / 60_000,
  );
  if (evidence.observed_rto_minutes !== elapsedRtoMinutes)
    throw new Error('restore drill observed RTO does not match started_at/completed_at');
  if (evidence.observed_rpo_minutes > inventory.objectives.rpo_minutes)
    throw new Error('restore drill exceeded the approved RPO');
  if (evidence.observed_rto_minutes > inventory.objectives.rto_minutes)
    throw new Error('restore drill exceeded the approved RTO');
  if (!Object.values(evidence.checks).every(Boolean))
    throw new Error('restore drill security checks are incomplete');
  return evidence;
}

/** Stable representation used when a production envelope binds to this drill. */
export function canonicalRestoreDrillEvidence(input: unknown, inventoryInput: unknown): string {
  return `${JSON.stringify(assertRestoreDrillEvidence(input, inventoryInput))}\n`;
}

/** SHA-256 of the validated, canonical restore-drill record. */
export function restoreDrillEvidenceSha256(input: unknown, inventoryInput: unknown): string {
  return createHash('sha256')
    .update(canonicalRestoreDrillEvidence(input, inventoryInput), 'utf8')
    .digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`restore drill ${label} must be an object`);
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
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new Error(`restore drill ${label} must be a bounded identifier`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value)))
    throw new Error(`restore drill ${label} must be an ISO UTC timestamp`);
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`restore drill ${label} must be a lowercase SHA-256 digest`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`restore drill ${label} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`restore drill ${label} must be a non-negative integer`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`restore drill ${label} must be boolean`);
  return value;
}

export type { BackupInventory };
