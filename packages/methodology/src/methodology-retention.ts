import { redactJson } from '@aqa/observability';
import type { MethodologyArtifactKind } from './methodology-governance.js';

export type MethodologyArtifactLifecycleState = 'active' | 'archived';

export interface MethodologyArtifactLifecycle {
  schema_version: '1';
  artifact_kind: MethodologyArtifactKind;
  artifact_id: string;
  revision: number;
  state: MethodologyArtifactLifecycleState;
  retained_until: string;
  archive_after: string;
  legal_hold: boolean;
  updated_at: string;
  updated_by: string;
  reason?: string;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const MAX_RETENTION_DAYS = 3650;
const KINDS = new Set<MethodologyArtifactKind>([
  'risk_map',
  'attack_tree',
  'fmea_report',
  'coverage_report',
]);

export function createMethodologyArtifactLifecycle(input: {
  artifact_kind: MethodologyArtifactKind;
  artifact_id: string;
  revision: number;
  now: string;
  updated_by: string;
  retention_days: number;
  archive_after_days?: number;
}): MethodologyArtifactLifecycle {
  assertTimestamp(input.now, 'now');
  assertIdentity(input.artifact_id, 'artifact_id');
  assertActor(input.updated_by, 'updated_by');
  assertRevision(input.revision);
  assertDays(input.retention_days, 'retention_days');
  const archiveAfterDays = input.archive_after_days ?? input.retention_days;
  assertDays(archiveAfterDays, 'archive_after_days');
  if (archiveAfterDays > input.retention_days)
    throw new Error('archive_after_days cannot exceed retention_days');
  const base = Date.parse(input.now);
  return {
    schema_version: '1',
    artifact_kind: input.artifact_kind,
    artifact_id: input.artifact_id,
    revision: input.revision,
    state: 'active',
    retained_until: new Date(base + input.retention_days * 86_400_000).toISOString(),
    archive_after: new Date(base + archiveAfterDays * 86_400_000).toISOString(),
    legal_hold: false,
    updated_at: input.now,
    updated_by: input.updated_by,
  };
}

export function parseMethodologyArtifactLifecycle(input: unknown): MethodologyArtifactLifecycle {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('methodology lifecycle must be an object');
  const value = input as Record<string, unknown>;
  const allowed = new Set([
    'schema_version',
    'artifact_kind',
    'artifact_id',
    'revision',
    'state',
    'retained_until',
    'archive_after',
    'legal_hold',
    'updated_at',
    'updated_by',
    'reason',
  ]);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) throw new Error('methodology lifecycle contains an unknown field');
  if (value.schema_version !== '1' || (value.state !== 'active' && value.state !== 'archived'))
    throw new Error('methodology lifecycle schema or state is invalid');
  if (
    typeof value.artifact_kind !== 'string' ||
    typeof value.artifact_id !== 'string' ||
    typeof value.updated_by !== 'string'
  )
    throw new Error('methodology lifecycle identity is invalid');
  if (!KINDS.has(value.artifact_kind as MethodologyArtifactKind))
    throw new Error('methodology lifecycle artifact kind is invalid');
  assertIdentity(value.artifact_id, 'artifact_id');
  assertActor(value.updated_by, 'updated_by');
  assertRevision(value.revision);
  if (typeof value.legal_hold !== 'boolean')
    throw new Error('methodology lifecycle legal_hold is invalid');
  for (const key of ['retained_until', 'archive_after', 'updated_at']) {
    if (typeof value[key] !== 'string') throw new Error(`methodology lifecycle ${key} is invalid`);
    assertTimestamp(value[key], key);
  }
  if (Date.parse(value.archive_after as string) > Date.parse(value.retained_until as string))
    throw new Error('methodology lifecycle archive_after exceeds retained_until');
  if (
    value.reason !== undefined &&
    (typeof value.reason !== 'string' || value.reason.length > 2000)
  )
    throw new Error('methodology lifecycle reason is invalid');
  assertDlpClean(value.reason);
  return value as unknown as MethodologyArtifactLifecycle;
}

export function archiveMethodologyArtifactLifecycle(
  lifecycle: MethodologyArtifactLifecycle,
  input: { now: string; updated_by: string; reason: string },
): MethodologyArtifactLifecycle {
  const current = parseMethodologyArtifactLifecycle(lifecycle);
  assertTimestamp(input.now, 'now');
  assertActor(input.updated_by, 'updated_by');
  if (!input.reason.trim() || input.reason.length > 2000)
    throw new Error('archive reason is invalid');
  assertDlpClean(input.reason);
  if (current.legal_hold) throw new Error('methodology artifact is protected by legal hold');
  return {
    ...current,
    state: 'archived',
    updated_at: input.now,
    updated_by: input.updated_by,
    reason: input.reason.trim(),
  };
}

export function setMethodologyArtifactLegalHold(
  lifecycle: MethodologyArtifactLifecycle,
  input: { now: string; updated_by: string; enabled: boolean; reason: string },
): MethodologyArtifactLifecycle {
  const current = parseMethodologyArtifactLifecycle(lifecycle);
  assertTimestamp(input.now, 'now');
  assertActor(input.updated_by, 'updated_by');
  if (!input.reason.trim() || input.reason.length > 2000)
    throw new Error('legal hold reason is invalid');
  assertDlpClean(input.reason);
  return {
    ...current,
    legal_hold: input.enabled,
    updated_at: input.now,
    updated_by: input.updated_by,
    reason: input.reason.trim(),
  };
}

export function isMethodologyArtifactExpired(
  lifecycle: MethodologyArtifactLifecycle,
  now: string,
): boolean {
  const current = parseMethodologyArtifactLifecycle(lifecycle);
  assertTimestamp(now, 'now');
  return !current.legal_hold && Date.parse(now) >= Date.parse(current.retained_until);
}

function assertIdentity(value: string, name: string): void {
  if (!ID.test(value)) throw new Error(`methodology lifecycle ${name} is invalid`);
}
function assertActor(value: string, name: string): void {
  if (!value.trim() || value.length > 256)
    throw new Error(`methodology lifecycle ${name} is invalid`);
}
function assertRevision(value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new Error('methodology lifecycle revision is invalid');
}
function assertTimestamp(value: string, name: string): void {
  if (!TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error(`methodology lifecycle ${name} is invalid`);
}
function assertDays(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RETENTION_DAYS)
    throw new Error(`${name} is outside the supported retention range`);
}

function assertDlpClean(value: unknown): void {
  if (redactJson(value) !== value)
    throw new Error('methodology lifecycle reason contains sensitive data');
}
