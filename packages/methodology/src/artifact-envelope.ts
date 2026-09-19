import {
  type MethodologyArtifactKind,
  canonicalMethodologyArtifact,
  methodologyArtifactSha256,
} from './methodology-governance.js';
import { type AttackTree, validateAttackTree } from './methodology.js';

export interface MethodologyArtifactEnvelope {
  schema_version: '1';
  artifact_kind: MethodologyArtifactKind;
  artifact_id: string;
  revision: number;
  created_at: string;
  artifact_sha256: string;
  payload: unknown;
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ARTIFACT_KINDS = new Set<MethodologyArtifactKind>([
  'risk_map',
  'attack_tree',
  'fmea_report',
  'coverage_report',
]);

/** Create a content-addressed, versioned record suitable for a durable adapter. */
export function createMethodologyArtifactEnvelope(input: {
  artifact_kind: MethodologyArtifactKind;
  artifact_id: string;
  revision: number;
  created_at: string;
  payload: unknown;
}): MethodologyArtifactEnvelope {
  assertEnvelopeMetadata(input);
  const payload = JSON.parse(canonicalMethodologyArtifact(input.payload)) as unknown;
  validatePayload(input.artifact_kind, payload);
  return {
    schema_version: '1',
    artifact_kind: input.artifact_kind,
    artifact_id: input.artifact_id,
    revision: input.revision,
    created_at: input.created_at,
    artifact_sha256: methodologyArtifactSha256(payload),
    payload,
  };
}

/** Serialize only after revalidating the envelope and its content binding. */
export function serializeMethodologyArtifactEnvelope(
  envelope: MethodologyArtifactEnvelope,
): string {
  const validated = parseMethodologyArtifactEnvelope(JSON.stringify(envelope));
  return JSON.stringify(validated);
}

/** Parse untrusted persisted data and fail closed on schema, digest or payload drift. */
export function parseMethodologyArtifactEnvelope(serialized: string): MethodologyArtifactEnvelope {
  if (typeof serialized !== 'string' || serialized.length > 400_000)
    throw new Error('methodology artifact envelope is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('methodology artifact envelope is not valid JSON');
  }
  if (!isRecord(parsed)) throw new Error('methodology artifact envelope must be an object');
  if (parsed.schema_version !== '1')
    throw new Error('methodology artifact envelope schema version is unsupported');
  const envelope = parsed as unknown as MethodologyArtifactEnvelope;
  assertEnvelopeMetadata(envelope);
  const payload = JSON.parse(canonicalMethodologyArtifact(envelope.payload)) as unknown;
  validatePayload(envelope.artifact_kind, payload);
  if (methodologyArtifactSha256(payload) !== envelope.artifact_sha256)
    throw new Error('methodology artifact envelope digest mismatch');
  return { ...envelope, payload };
}

function assertEnvelopeMetadata(value: {
  artifact_kind: MethodologyArtifactKind;
  artifact_id: string;
  revision: number;
  created_at: string;
}): void {
  if (!ARTIFACT_KINDS.has(value.artifact_kind))
    throw new Error('methodology artifact envelope kind is invalid');
  if (!ID.test(value.artifact_id)) throw new Error('methodology artifact envelope id is invalid');
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new Error('methodology artifact envelope revision is invalid');
  if (!UTC_TIMESTAMP.test(value.created_at) || !Number.isFinite(Date.parse(value.created_at)))
    throw new Error('methodology artifact envelope timestamp is invalid');
}

function validatePayload(kind: MethodologyArtifactKind, payload: unknown): void {
  if (kind === 'attack_tree') validateAttackTree(payload as AttackTree);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
