import { createHash } from 'node:crypto';
import { redactJson } from '@aqa/observability';

export type MethodologyArtifactKind =
  | 'risk_map'
  | 'attack_tree'
  | 'fmea_report'
  | 'coverage_report';
export type MethodologyProposalSource = 'human' | 'agent';

export interface MethodologyProposal {
  schema_version: '1';
  proposal_id: string;
  artifact_kind: MethodologyArtifactKind;
  artifact_id: string;
  artifact_sha256: string;
  revision: number;
  proposed_by: string;
  proposed_at: string;
  source: MethodologyProposalSource;
  status: 'pending' | 'approved' | 'rejected';
}

export interface MethodologyApproval {
  schema_version: '1';
  approval_id: string;
  proposal_id: string;
  artifact_sha256: string;
  revision: number;
  approved_by: string;
  approved_at: string;
  expires_at?: string;
}

export interface MethodologyApprovalResult {
  proposal: MethodologyProposal & { status: 'approved' };
  approval: MethodologyApproval;
}

export interface MethodologyRejection {
  schema_version: '1';
  rejection_id: string;
  proposal_id: string;
  rejected_by: string;
  rejected_at: string;
  reason: string;
}

export interface MethodologyRejectionResult {
  proposal: MethodologyProposal & { status: 'rejected' };
  rejection: MethodologyRejection;
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_DEPTH = 16;
const MAX_NODES = 4096;
const MAX_BYTES = 256_000;
const ARTIFACT_KINDS = new Set<MethodologyArtifactKind>([
  'risk_map',
  'attack_tree',
  'fmea_report',
  'coverage_report',
]);
const PROPOSAL_SOURCES = new Set<MethodologyProposalSource>(['human', 'agent']);
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/**
 * Produce a stable, bounded JSON representation for methodology artifacts.
 * The artifact itself is deliberately not stored in the approval record: the
 * digest binds the operator decision to the exact payload kept by the host.
 */
export function canonicalMethodologyArtifact(value: unknown): string {
  let nodes = 0;
  const visit = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > MAX_NODES) throw new Error('methodology artifact exceeds node limit');
    if (depth > MAX_DEPTH) throw new Error('methodology artifact exceeds depth limit');
    if (current === null || typeof current === 'string' || typeof current === 'boolean')
      return current;
    if (typeof current === 'number') {
      if (!Number.isFinite(current))
        throw new Error('methodology artifact contains a non-finite number');
      return current;
    }
    if (Array.isArray(current)) return current.map((item) => visit(item, depth + 1));
    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => {
            if (!key || key.length > 128)
              throw new Error('methodology artifact has an invalid key');
            const item = record[key];
            if (item === undefined || typeof item === 'function' || typeof item === 'bigint')
              throw new Error('methodology artifact contains an unsupported value');
            return [key, visit(item, depth + 1)];
          }),
      );
    }
    throw new Error('methodology artifact contains an unsupported value');
  };
  const canonical = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(canonical, 'utf8') > MAX_BYTES)
    throw new Error('methodology artifact exceeds byte limit');
  return canonical;
}

export function methodologyArtifactSha256(value: unknown): string {
  return createHash('sha256').update(canonicalMethodologyArtifact(value), 'utf8').digest('hex');
}

export function createMethodologyProposal(input: {
  proposal_id: string;
  artifact_kind: MethodologyArtifactKind;
  artifact_id: string;
  artifact: unknown;
  revision: number;
  proposed_by: string;
  proposed_at: string;
  source: MethodologyProposalSource;
}): MethodologyProposal {
  assertId(input.proposal_id, 'proposal_id');
  assertArtifactKind(input.artifact_kind);
  assertId(input.artifact_id, 'artifact_id');
  assertActor(input.proposed_by, 'proposed_by');
  assertRevision(input.revision);
  assertTimestamp(input.proposed_at, 'proposed_at');
  assertProposalSource(input.source);
  return {
    schema_version: '1',
    proposal_id: input.proposal_id,
    artifact_kind: input.artifact_kind,
    artifact_id: input.artifact_id,
    artifact_sha256: methodologyArtifactSha256(input.artifact),
    revision: input.revision,
    proposed_by: input.proposed_by,
    proposed_at: input.proposed_at,
    source: input.source,
    status: 'pending',
  };
}

/** Parse and normalize an untrusted proposal, rejecting unknown fields. */
export function parseMethodologyProposal(input: unknown): MethodologyProposal {
  const record = strictRecord(input, [
    'schema_version',
    'proposal_id',
    'artifact_kind',
    'artifact_id',
    'artifact_sha256',
    'revision',
    'proposed_by',
    'proposed_at',
    'source',
    'status',
  ]);
  const proposal = {
    schema_version: record.schema_version,
    proposal_id: record.proposal_id,
    artifact_kind: record.artifact_kind,
    artifact_id: record.artifact_id,
    artifact_sha256: record.artifact_sha256,
    revision: record.revision,
    proposed_by: record.proposed_by,
    proposed_at: record.proposed_at,
    source: record.source,
    status: record.status,
  } as MethodologyProposal;
  assertStringFields(proposal, [
    'schema_version',
    'proposal_id',
    'artifact_kind',
    'artifact_id',
    'artifact_sha256',
    'proposed_by',
    'proposed_at',
    'source',
    'status',
  ]);
  if (typeof proposal.revision !== 'number')
    throw new Error('methodology proposal revision must be a number');
  assertDlpClean(proposal);
  validateProposal(proposal);
  return proposal;
}

/** Parse and normalize an untrusted approval, rejecting unknown fields. */
export function parseMethodologyApproval(input: unknown): MethodologyApproval {
  const record = strictRecord(input, [
    'schema_version',
    'approval_id',
    'proposal_id',
    'artifact_sha256',
    'revision',
    'approved_by',
    'approved_at',
    'expires_at',
  ]);
  const approval = {
    schema_version: record.schema_version,
    approval_id: record.approval_id,
    proposal_id: record.proposal_id,
    artifact_sha256: record.artifact_sha256,
    revision: record.revision,
    approved_by: record.approved_by,
    approved_at: record.approved_at,
    ...('expires_at' in record ? { expires_at: record.expires_at } : {}),
  } as MethodologyApproval;
  assertStringFields(approval, [
    'schema_version',
    'approval_id',
    'proposal_id',
    'artifact_sha256',
    'approved_by',
    'approved_at',
  ]);
  if (typeof approval.revision !== 'number')
    throw new Error('methodology approval revision must be a number');
  if ('expires_at' in record && typeof record.expires_at !== 'string')
    throw new Error('methodology approval expires_at must be a string');
  assertDlpClean(approval);
  validateApproval(approval);
  return approval;
}

/** Parse and normalize an untrusted rejection, rejecting unknown fields. */
export function parseMethodologyRejection(input: unknown): MethodologyRejection {
  const record = strictRecord(input, [
    'schema_version',
    'rejection_id',
    'proposal_id',
    'rejected_by',
    'rejected_at',
    'reason',
  ]);
  const rejection = {
    schema_version: record.schema_version,
    rejection_id: record.rejection_id,
    proposal_id: record.proposal_id,
    rejected_by: record.rejected_by,
    rejected_at: record.rejected_at,
    reason: record.reason,
  } as MethodologyRejection;
  assertStringFields(rejection, [
    'schema_version',
    'rejection_id',
    'proposal_id',
    'rejected_by',
    'rejected_at',
    'reason',
  ]);
  assertDlpClean(rejection);
  validateRejection(rejection);
  return rejection;
}

/** Approve only the exact pending revision, with an independent human reviewer. */
export function approveMethodologyProposal(
  proposal: MethodologyProposal,
  approval: MethodologyApproval,
  now = new Date(),
): MethodologyApprovalResult {
  validateProposal(proposal);
  validateApproval(approval);
  if (proposal.status !== 'pending') throw new Error('methodology proposal is not pending');
  if (approval.proposal_id !== proposal.proposal_id)
    throw new Error('methodology approval proposal mismatch');
  if (approval.artifact_sha256 !== proposal.artifact_sha256)
    throw new Error('methodology approval artifact digest mismatch');
  if (approval.revision !== proposal.revision)
    throw new Error('methodology approval revision mismatch');
  if (approval.approved_by === proposal.proposed_by)
    throw new Error('methodology approval requires an independent reviewer');
  if (Date.parse(approval.approved_at) > now.getTime())
    throw new Error('methodology approval cannot be issued in the future');
  if (
    approval.expires_at !== undefined &&
    Date.parse(approval.expires_at) <= Date.parse(approval.approved_at)
  )
    throw new Error('methodology approval expiry must be after approval time');
  if (approval.expires_at !== undefined && Date.parse(approval.expires_at) <= now.getTime())
    throw new Error('methodology approval has already expired');
  return {
    proposal: { ...proposal, status: 'approved' },
    approval,
  };
}

export function assertMethodologyApproval(
  proposal: MethodologyProposal,
  approval: MethodologyApproval,
  now = new Date(),
): void {
  const result = approveMethodologyProposal(
    proposal.status === 'approved' ? { ...proposal, status: 'pending' } : proposal,
    approval,
    now,
  );
  if (result.proposal.status !== 'approved') throw new Error('methodology approval is invalid');
  if (approval.expires_at !== undefined && Date.parse(approval.expires_at) <= now.getTime())
    throw new Error('methodology approval has expired');
}

/** Reject only the exact pending proposal, with an independent reviewer decision. */
export function rejectMethodologyProposal(
  proposal: MethodologyProposal,
  rejection: MethodologyRejection,
  now = new Date(),
): MethodologyRejectionResult {
  validateProposal(proposal);
  const normalized = parseMethodologyRejection(rejection);
  if (proposal.status !== 'pending') throw new Error('methodology proposal is not pending');
  if (normalized.proposal_id !== proposal.proposal_id)
    throw new Error('methodology rejection proposal mismatch');
  if (normalized.rejected_by === proposal.proposed_by)
    throw new Error('methodology rejection requires an independent reviewer');
  if (Date.parse(normalized.rejected_at) > now.getTime())
    throw new Error('methodology rejection cannot be issued in the future');
  return { proposal: { ...proposal, status: 'rejected' }, rejection: normalized };
}

/** Validate a proposal before a durable adapter accepts it. */
export function assertMethodologyProposal(proposal: MethodologyProposal): void {
  validateProposal(proposal);
}

function validateProposal(proposal: MethodologyProposal): void {
  if (proposal.schema_version !== '1')
    throw new Error('methodology proposal schema version is unsupported');
  assertId(proposal.proposal_id, 'proposal_id');
  assertArtifactKind(proposal.artifact_kind);
  assertId(proposal.artifact_id, 'artifact_id');
  assertActor(proposal.proposed_by, 'proposed_by');
  assertRevision(proposal.revision);
  assertTimestamp(proposal.proposed_at, 'proposed_at');
  assertProposalSource(proposal.source);
  if (!['pending', 'approved', 'rejected'].includes(proposal.status))
    throw new Error('methodology proposal status is invalid');
  if (!SHA256.test(proposal.artifact_sha256))
    throw new Error('methodology proposal digest is invalid');
}

function validateApproval(approval: MethodologyApproval): void {
  if (approval.schema_version !== '1')
    throw new Error('methodology approval schema version is unsupported');
  assertId(approval.approval_id, 'approval_id');
  assertId(approval.proposal_id, 'proposal_id');
  assertActor(approval.approved_by, 'approved_by');
  assertRevision(approval.revision);
  assertTimestamp(approval.approved_at, 'approved_at');
  if (!SHA256.test(approval.artifact_sha256))
    throw new Error('methodology approval digest is invalid');
  if (approval.expires_at !== undefined) assertTimestamp(approval.expires_at, 'expires_at');
}

function validateRejection(rejection: MethodologyRejection): void {
  if (rejection.schema_version !== '1')
    throw new Error('methodology rejection schema version is unsupported');
  assertId(rejection.rejection_id, 'rejection_id');
  assertId(rejection.proposal_id, 'proposal_id');
  assertActor(rejection.rejected_by, 'rejected_by');
  assertTimestamp(rejection.rejected_at, 'rejected_at');
  if (!rejection.reason.trim() || rejection.reason.length > 2_000)
    throw new Error('methodology rejection reason is invalid');
}

function assertStringFields(value: object, fields: readonly string[]): void {
  const record = value as Record<string, unknown>;
  for (const field of fields) {
    if (typeof record[field] !== 'string')
      throw new Error(`methodology governance field ${field} must be a string`);
  }
}

function strictRecord(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('methodology governance record must be an object');
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => !allowed.includes(key)))
    throw new Error('methodology governance record contains an unknown field');
  return record;
}

function assertDlpClean(value: unknown): void {
  if (canonicalMethodologyArtifact(redactJson(value)) !== canonicalMethodologyArtifact(value))
    throw new Error('methodology governance record contains sensitive data');
}

function assertId(value: string, label: string): void {
  if (!ID.test(value)) throw new Error(`methodology ${label} is invalid`);
}

function assertArtifactKind(value: MethodologyArtifactKind): void {
  if (!ARTIFACT_KINDS.has(value)) throw new Error('methodology artifact kind is invalid');
}

function assertProposalSource(value: MethodologyProposalSource): void {
  if (!PROPOSAL_SOURCES.has(value)) throw new Error('methodology proposal source is invalid');
}

function assertActor(value: string, label: string): void {
  if (!value.trim() || value.length > 256) throw new Error(`methodology ${label} is invalid`);
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('methodology revision must be a positive integer');
}

function assertTimestamp(value: string, label: string): void {
  if (!UTC_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error(`methodology ${label} must be a canonical UTC timestamp`);
}
