import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventChainWriter } from '../dist/events.js';
import { FindingsWriter } from '../dist/findings.js';
import { makeHttpProbeRunner, runScenario } from '../dist/run.js';

const SCENARIO = {
  schema_version: '1' as const,
  id: 'scn-demo',
  title: 'Old token rejected after rotation',
  risk_refs: ['r-token-replay'],
  invariant_refs: [],
  preconditions: [],
  steps: [
    {
      id: 'probe-rotate',
      kind: 'http' as const,
      with: { method: 'POST', url: '/auth/rotate' },
      timeout_ms: 5000,
    },
    {
      id: 'probe-use-old',
      kind: 'http' as const,
      with: { method: 'GET', url: '/me' },
      timeout_ms: 5000,
    },
  ],
  oracles: [{ id: 'o-401', kind: 'http_status' as const, with: { expected: 401 }, weight: 1 }],
  cleanup: [],
  tags: [],
};

describe('runScenario', () => {
  it('emits a finding when the oracle fails (200 instead of 401)', async () => {
    const events = new EventChainWriter('/tmp/_ignore', { persist: false });
    const findings = new FindingsWriter('/tmp/_ignore', { persist: false });
    const result = await runScenario({
      scenario: SCENARIO,
      run_id: 'run-1',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
      events,
      findings,
      findingIdSeed: 1,
    });
    assert.equal(result.oracles[0]?.passed, false);
    assert.ok(result.finding);
    assert.equal(result.finding?.severity, 'high');
    assert.equal(findings.snapshot().length, 1);
    const kinds = events.snapshot().map((e) => e.kind);
    assert.ok(kinds.includes('probe_executed'));
    assert.ok(kinds.includes('oracle_evaluated'));
    assert.ok(kinds.includes('finding_emitted'));
  });

  it('emits no finding when the oracle passes', async () => {
    const result = await runScenario({
      scenario: SCENARIO,
      run_id: 'run-2',
      probeRunner: async (p) => ({ probe_id: p.id, status: 401 }),
    });
    assert.equal(result.oracles[0]?.passed, true);
    assert.equal(result.finding, null);
  });

  it('dedups identical findings within the same run', async () => {
    const findings = new FindingsWriter('/tmp/_ignore', { persist: false });
    await runScenario({
      scenario: SCENARIO,
      run_id: 'run-3',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
      findings,
      findingIdSeed: 1,
    });
    await runScenario({
      scenario: SCENARIO,
      run_id: 'run-3',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
      findings,
      findingIdSeed: 2,
    });
    // Same run_id + scenario_id + risk_id + severity → second finding dedup'd.
    assert.equal(findings.snapshot().length, 1);
  });

  it('makeHttpProbeRunner executes relative HTTP probes against baseUrl', async () => {
    const originalFetch = globalThis.fetch;
    let seenUrl = '';
    globalThis.fetch = (async (input) => {
      seenUrl = String(input);
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const runner = makeHttpProbeRunner({ baseUrl: 'http://localhost:3000' });
      const result = await runner({
        id: 'probe-http',
        kind: 'http',
        with: { method: 'post', url: '/health', body: { hello: 'world' } },
        timeout_ms: 1000,
      });
      assert.equal(seenUrl, 'http://localhost:3000/health');
      assert.equal(result.status, 201);
      assert.deepEqual(result.body, { ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('makeHttpProbeRunner rejects unsupported probe kinds', async () => {
    const runner = makeHttpProbeRunner({ baseUrl: 'http://localhost:3000' });
    const result = await runner({
      id: 'probe-shell',
      kind: 'shell',
      with: {},
      timeout_ms: 1000,
    });
    assert.match(result.error ?? '', /unsupported probe kind/i);
  });
});
