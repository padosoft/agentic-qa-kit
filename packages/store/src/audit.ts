import { createHash } from 'node:crypto';
import { Event, type Finding } from '@aqa/schemas';

const ZERO_HASH = '0'.repeat(64);

export class InvalidFindingTransitionError extends Error {
  readonly code = 'INVALID_FINDING_TRANSITION';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidFindingTransitionError';
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`;
}

export function findingStatusAudit(
  finding: Finding.Finding,
  actor: string,
  from: Finding.Finding['status'],
  to: Finding.Finding['status'],
  reason: string,
  seq: number,
  previous: Event.Event | undefined,
): Event.Event {
  const event = {
    schema_version: '1' as const,
    seq,
    prev_hash: previous?.hash ?? null,
    hash: '',
    ts: new Date().toISOString(),
    run_id: finding.run_id,
    kind: 'info' as const,
    actor: { type: 'system' as const, id: actor },
    finding_id: finding.id,
    payload: { action: 'finding_status_changed', from, to, reason },
  };
  const { prev_hash: _prevHash, hash: _hash, ...rest } = event;
  event.hash = createHash('sha256')
    .update(previous?.hash ?? ZERO_HASH)
    .update(canonical(rest))
    .digest('hex');
  return Event.Event.parse(event);
}
