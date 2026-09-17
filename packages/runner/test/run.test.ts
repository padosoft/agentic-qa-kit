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

  it('does not turn a missing probe runner into a security finding', async () => {
    const result = await runScenario({
      scenario: {
        ...SCENARIO,
        oracles: [
          { id: 'o-no-error', kind: 'response_not_contains', with: { value: 'PWNED' }, weight: 1 },
        ],
      },
      run_id: 'run-no-driver',
    });
    assert.equal(result.probes[0]?.error, 'no probe runner configured');
    assert.equal(result.execution_status, 'failed');
    assert.equal(result.oracles[0]?.passed, false);
    assert.equal(result.finding, null);
  });

  it('runs every cleanup probe after a failed step and records cleanup failures', async () => {
    const calls: string[] = [];
    const result = await runScenario({
      scenario: {
        ...SCENARIO,
        cleanup: [
          {
            id: 'cleanup-one',
            kind: 'http',
            with: { method: 'DELETE', url: '/fixture/one' },
            timeout_ms: 1000,
          },
          {
            id: 'cleanup-two',
            kind: 'http',
            with: { method: 'DELETE', url: '/fixture/two' },
            timeout_ms: 1000,
          },
        ],
      },
      run_id: 'run-cleanup',
      probeRunner: async (probe) => {
        calls.push(probe.id);
        if (probe.id === 'cleanup-two') throw new Error('cleanup service unavailable');
        return { probe_id: probe.id, status: 200 };
      },
    });
    assert.deepEqual(calls, ['probe-rotate', 'probe-use-old', 'cleanup-one', 'cleanup-two']);
    assert.equal(result.cleanup.length, 2);
    assert.match(result.cleanup[1]?.error ?? '', /cleanup service unavailable/);
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

  it('generates distinct finding IDs across runs even with the same scenario seed', async () => {
    const findings = new FindingsWriter('/tmp/_ignore', { persist: false });
    const first = await runScenario({
      scenario: SCENARIO,
      run_id: 'run-id-first',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
      findings,
      findingIdSeed: 1,
    });
    const second = await runScenario({
      scenario: SCENARIO,
      run_id: 'run-id-second',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
      findings,
      findingIdSeed: 1,
    });
    assert.ok(first.finding);
    assert.ok(second.finding);
    assert.notEqual(first.finding?.id, second.finding?.id);
    assert.equal(findings.snapshot().length, 2);
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

  it('makeHttpProbeRunner blocks non-allowlisted origins and oversized responses', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('0123456789');
    }) as typeof fetch;
    try {
      const runner = makeHttpProbeRunner({
        baseUrl: 'https://shop.example',
        max_response_bytes: 5,
      });
      const external = await runner({
        id: 'external',
        kind: 'http',
        with: { method: 'GET', url: 'https://evil.example/data' },
        timeout_ms: 1000,
      });
      assert.match(external.error ?? '', /not allowlisted/);
      assert.equal(calls, 0);
      const oversized = await runner({
        id: 'large',
        kind: 'http',
        with: { method: 'GET', url: '/large' },
        timeout_ms: 1000,
      });
      assert.match(oversized.error ?? '', /exceeds 5 bytes/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
