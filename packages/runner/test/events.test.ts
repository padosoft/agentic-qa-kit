import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { makeBudgetEventSink } from '../dist/budget-events.js';
import { EventChainWriter } from '../dist/events.js';

const ZERO_HASH = '0'.repeat(64);

describe('EventChainWriter', () => {
  it('bridges bounded LLM budget events into the hash chain without prompt data', () => {
    const writer = new EventChainWriter('/tmp/_ignore', { persist: false });
    const sink = makeBudgetEventSink({
      events: writer,
      run_id: 'run-budget-bridge',
      scenario_id: 'scenario-1',
    });
    sink({
      kind: 'llm_call',
      ts: '2026-09-18T10:00:00.000Z',
      provider: 'fixture',
      model: 'model-1',
      status: 'completed',
      tokens_in: 12,
      tokens_out: 7,
      cost_usd: 0.001,
      reason: 'provider usage recorded',
    });
    sink({
      kind: 'budget_exceeded',
      ts: '2026-09-18T10:00:01.000Z',
      provider: 'fixture',
      model: 'model-1',
      status: 'exhausted',
      reason: 'budget exhausted after call',
    });
    const events = writer.snapshot();
    assert.deepEqual(
      events.map((event) => event.kind),
      ['llm_call', 'budget_exceeded'],
    );
    assert.equal(events[0]?.run_id, 'run-budget-bridge');
    assert.equal(events[0]?.scenario_id, 'scenario-1');
    assert.equal(events[0]?.payload.tokens_in, 12);
    assert.equal(events[1]?.prev_hash, events[0]?.hash);
    assert.doesNotMatch(JSON.stringify(events), /prompt|completion|secret/i);
  });

  it('fails closed for malformed accounting values and redacts reason text', () => {
    const writer = new EventChainWriter('/tmp/_ignore', { persist: false });
    const sink = makeBudgetEventSink({ events: writer, run_id: 'run-budget-bounds' });
    sink({
      kind: 'llm_call',
      ts: '2026-09-18T10:00:00.000Z',
      provider: 'fixture',
      model: 'model-1',
      status: 'completed',
      tokens_in: Number.MAX_SAFE_INTEGER,
      tokens_out: -1,
      cost_usd: Number.POSITIVE_INFINITY,
      reason: 'authorization: Bearer super-secret',
    });
    const payload = writer.snapshot()[0]?.payload;
    assert.equal(payload?.tokens_in, 1_000_000_000_000);
    assert.equal(payload?.tokens_out, undefined);
    assert.equal(payload?.cost_usd, undefined);
    assert.equal(payload?.reason, 'authorization: Bearer [REDACTED]');
  });

  it('invokes a non-blocking observer without allowing telemetry failure to break the chain', () => {
    const observed: string[] = [];
    const writer = new EventChainWriter('/tmp/_ignore', {
      persist: false,
      onEvent: (event) => {
        observed.push(event.kind);
        throw new Error('telemetry sink unavailable');
      },
    });
    const event = writer.append({
      ts: '2026-09-17T00:00:00.000Z',
      run_id: 'run-observer',
      kind: 'run_started',
      actor: { type: 'system', id: 'test' },
    });
    assert.equal(event.seq, 0);
    assert.deepEqual(observed, ['run_started']);
    assert.equal(writer.snapshot().length, 1);
  });
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

  it('redacts sensitive payload values before hashing and persistence', () => {
    const writer = new EventChainWriter('/tmp/_ignore', { persist: false });
    const event = writer.append({
      ts: '2026-05-17T10:00:00Z',
      run_id: 'run-redact',
      kind: 'info',
      actor: { type: 'system', id: 'test' },
      payload: {
        authorization: 'Bearer super-secret',
        nested: { api_key: 'key-value' },
        card: '4111111111111111',
      },
    });
    assert.equal(event.payload.authorization, '[REDACTED]');
    assert.equal((event.payload.nested as Record<string, unknown>).api_key, '[REDACTED]');
    assert.equal(event.payload.card, '[REDACTED-PAN]');
    assert.doesNotMatch(JSON.stringify(event), /super-secret|key-value|4111111111111111/);
  });
});
