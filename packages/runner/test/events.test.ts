import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { EventChainWriter } from '../dist/events.js';

const ZERO_HASH = '0'.repeat(64);

describe('EventChainWriter', () => {
  it('first event has prev_hash=null and seq=0', () => {
    const w = new EventChainWriter('/tmp/_ignore', { persist: false });
    const e = w.append({
      ts: '2026-05-17T10:00:00Z',
      run_id: 'run-1',
      kind: 'run_started',
      actor: { type: 'orchestrator', id: 'runner' },
    });
    assert.equal(e.seq, 0);
    assert.equal(e.prev_hash, null);
    assert.match(e.hash, /^[a-f0-9]{64}$/);
  });

  it('every subsequent event carries the previous hash', () => {
    const w = new EventChainWriter('/tmp/_ignore', { persist: false });
    const a = w.append({
      ts: '2026-05-17T10:00:00Z',
      run_id: 'r',
      kind: 'run_started',
      actor: { type: 'orchestrator', id: 'x' },
    });
    const b = w.append({
      ts: '2026-05-17T10:00:01Z',
      run_id: 'r',
      kind: 'run_finished',
      actor: { type: 'orchestrator', id: 'x' },
    });
    assert.equal(b.prev_hash, a.hash);
    assert.equal(b.seq, 1);
  });

  it('the chain is verifiable end-to-end', () => {
    const w = new EventChainWriter('/tmp/_ignore', { persist: false });
    for (let i = 0; i < 5; i++) {
      w.append({
        ts: `2026-05-17T10:00:0${i}Z`,
        run_id: 'r',
        kind: 'probe_executed',
        actor: { type: 'orchestrator', id: 'x' },
        payload: { i },
      });
    }
    const events = w.snapshot();
    let prev = ZERO_HASH;
    for (const ev of events) {
      const rest: Record<string, unknown> = {
        schema_version: ev.schema_version,
        seq: ev.seq,
        ts: ev.ts,
        run_id: ev.run_id,
        kind: ev.kind,
        actor: ev.actor,
        scenario_id: ev.scenario_id,
        finding_id: ev.finding_id,
        payload: ev.payload,
      };
      const canon = JSON.stringify(rest, (_k, v) => {
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
      const expected = createHash('sha256')
        .update(prev + canon)
        .digest('hex');
      assert.equal(ev.hash, expected, `hash mismatch at seq=${ev.seq}`);
      prev = ev.hash;
    }
  });
});
