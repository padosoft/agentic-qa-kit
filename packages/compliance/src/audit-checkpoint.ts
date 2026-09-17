import { createHash, sign, verify } from 'node:crypto';
import { canonicalStringify } from './audit-canonical.js';
import { type AuditEvent, verifyEventChain } from './audit-verify.js';

export interface AuditCheckpointSignature {
  algorithm: 'ed25519';
  key_id: string;
  signature: string;
}

export interface AuditCheckpoint {
  schema_version: '1';
  run_id: string;
  first_seq: number;
  last_seq: number;
  event_count: number;
  head_hash: string | null;
  events_sha256: string;
  created_at: string;
  signature?: AuditCheckpointSignature;
}

export interface AuditCheckpointSigner {
  key_id: string;
  private_key_pem: string;
}

export interface AuditCheckpointVerifyResult {
  ok: boolean;
  reason?: string;
  event_count: number;
}

function unsignedCheckpoint(checkpoint: AuditCheckpoint): Omit<AuditCheckpoint, 'signature'> {
  const { signature: _signature, ...unsigned } = checkpoint;
  return unsigned;
}

function checkpointPayload(checkpoint: AuditCheckpoint): Buffer {
  return Buffer.from(canonicalStringify(unsignedCheckpoint(checkpoint)), 'utf8');
}

function eventDigest(events: readonly AuditEvent[]): string {
  const bytes = events.map((event) => `${canonicalStringify(event)}\n`).join('');
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function validateRun(events: readonly AuditEvent[]): string {
  if (events.length === 0) throw new Error('audit checkpoint requires at least one event');
  const runId = events[0]?.run_id;
  if (typeof runId !== 'string' || !runId) throw new Error('audit checkpoint requires a run_id');
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.run_id !== runId) throw new Error('audit checkpoint cannot mix run IDs');
    if (event?.seq !== index)
      throw new Error('audit checkpoint requires contiguous event sequences');
  }
  const chain = verifyEventChain([...events]);
  if (!chain.ok) throw new Error(`audit chain is invalid: ${chain.reason ?? 'unknown error'}`);
  return runId;
}

export function createAuditCheckpoint(
  events: readonly AuditEvent[],
  signer?: AuditCheckpointSigner,
  now: () => Date = () => new Date(),
): AuditCheckpoint {
  const runId = validateRun(events);
  if (signer && !signer.key_id.trim()) throw new Error('audit checkpoint key_id is required');
  const checkpoint: AuditCheckpoint = {
    schema_version: '1',
    run_id: runId,
    first_seq: 0,
    last_seq: events.length - 1,
    event_count: events.length,
    head_hash: events.at(-1)?.hash ?? null,
    events_sha256: eventDigest(events),
    created_at: now().toISOString(),
  };
  if (!signer) return checkpoint;
  return {
    ...checkpoint,
    signature: {
      algorithm: 'ed25519',
      key_id: signer.key_id.trim(),
      signature: sign(null, checkpointPayload(checkpoint), signer.private_key_pem).toString(
        'base64url',
      ),
    },
  };
}

export function verifyAuditCheckpoint(
  events: readonly AuditEvent[],
  checkpoint: AuditCheckpoint,
  trustedPublicKeyPem?: string,
): AuditCheckpointVerifyResult {
  try {
    const runId = validateRun(events);
    if (checkpoint.schema_version !== '1') throw new Error('unsupported checkpoint schema');
    if (checkpoint.run_id !== runId) throw new Error('checkpoint run_id mismatch');
    if (checkpoint.first_seq !== 0 || checkpoint.last_seq !== events.length - 1)
      throw new Error('checkpoint sequence bounds mismatch');
    if (checkpoint.event_count !== events.length)
      throw new Error('checkpoint event count mismatch');
    if (checkpoint.head_hash !== events.at(-1)?.hash)
      throw new Error('checkpoint head hash mismatch');
    if (checkpoint.events_sha256 !== eventDigest(events))
      throw new Error('checkpoint event digest mismatch');
    if (checkpoint.signature) {
      if (!trustedPublicKeyPem) throw new Error('checkpoint signature has no trusted public key');
      if (checkpoint.signature.algorithm !== 'ed25519')
        throw new Error('unsupported checkpoint signature');
      const valid = verify(
        null,
        checkpointPayload(checkpoint),
        trustedPublicKeyPem,
        Buffer.from(checkpoint.signature.signature, 'base64url'),
      );
      if (!valid) throw new Error('checkpoint signature mismatch');
    }
    return { ok: true, event_count: events.length };
  } catch (error) {
    return {
      ok: false,
      event_count: events.length,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
