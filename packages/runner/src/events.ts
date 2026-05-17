import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Event } from '@aqa/schemas';

const ZERO_HASH = '0'.repeat(64);

function canonicalise(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as object)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
}

export interface EventDraft {
  ts: string;
  run_id: string;
  kind: Event.EventKind;
  actor: { type: 'orchestrator' | 'agent' | 'system'; id: string; model?: string };
  scenario_id?: string;
  finding_id?: string;
  payload?: Record<string, unknown>;
}

/**
 * Append-only hash-chained writer for `.aqa/runs/<id>/events.jsonl`.
 *
 * Each event computes `hash = sha256(prev_hash || canonical(rest_of_event))`,
 * giving the log the same tamper-evident property an SOC2 auditor expects.
 * The seed `prev_hash` of the first event is 64 zero hex chars.
 */
export class EventChainWriter {
  private seq = 0;
  private prevHash: string = ZERO_HASH;
  private readonly path: string;
  private readonly events: Event.Event[] = [];
  private readonly persist: boolean;

  constructor(path: string, opts: { persist?: boolean } = { persist: true }) {
    this.path = path;
    this.persist = opts.persist ?? true;
    if (this.persist) mkdirSync(dirname(path), { recursive: true });
  }

  /** Append an event; returns the validated event including seq/hash/prev_hash. */
  append(draft: EventDraft): Event.Event {
    const rest = {
      schema_version: '1' as const,
      seq: this.seq,
      ts: draft.ts,
      run_id: draft.run_id,
      kind: draft.kind,
      actor: draft.actor,
      scenario_id: draft.scenario_id,
      finding_id: draft.finding_id,
      payload: draft.payload ?? {},
    };
    const hashInput = this.prevHash + canonicalise(rest);
    const hash = createHash('sha256').update(hashInput).digest('hex');
    const event = Event.Event.parse({
      ...rest,
      prev_hash: this.seq === 0 ? null : this.prevHash,
      hash,
    });
    this.events.push(event);
    if (this.persist) appendFileSync(this.path, `${JSON.stringify(event)}\n`, 'utf8');
    this.seq += 1;
    this.prevHash = hash;
    return event;
  }

  /** Read-only snapshot of events written so far. */
  snapshot(): readonly Event.Event[] {
    return this.events;
  }
}
