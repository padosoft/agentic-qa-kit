import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { failureFingerprint } from '../dist/fingerprint.js';
import { verifyScenario } from '../dist/replay.js';

const SCENARIO = {
  schema_version: '1' as const,
  id: 'scn',
  title: 'replay sample',
  risk_refs: ['r'],
  invariant_refs: [],
  preconditions: [],
  steps: [{ id: 'p', kind: 'http' as const, with: { method: 'GET', url: '/' }, timeout_ms: 1000 }],
  oracles: [{ id: 'o', kind: 'http_status' as const, with: { expected: 401 }, weight: 1 }],
  cleanup: [],
  tags: [],
};

describe('verifyScenario', () => {
  it('produces a stable fingerprint for the failed oracle set', async () => {
    const first = await verifyScenario({
      scenario: SCENARIO,
      run_id: 'run-fingerprint-a',
      attempts: 1,
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
    });
    const second = await verifyScenario({
      scenario: SCENARIO,
      run_id: 'run-fingerprint-b',
      attempts: 1,
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
    });
    assert.equal(first.fingerprint, second.fingerprint);
    assert.match(first.fingerprint ?? '', /^[0-9a-f]{64}$/u);
    assert.equal(
      first.fingerprint,
      failureFingerprint({
        scenario_id: SCENARIO.id,
        outcome: 'fail',
        execution_status: 'completed',
        probes: [{ probe_id: 'p', status: 200 }],
        cleanup: [],
        oracles: [
          { oracle_id: 'o', passed: false, reason: 'expected status 401, got 200', agreement: 0 },
        ],
        finding: null,
      }),
    );
  });

  it('deterministic=true when every attempt reproduces the finding', async () => {
    const r = await verifyScenario({
      scenario: SCENARIO,
      run_id: 'run-a',
      attempts: 3,
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
    });
    assert.equal(r.attempts, 3);
    assert.equal(r.successes, 3);
    assert.equal(r.deterministic, true);
  });

  it('deterministic=false when at least one attempt fails to reproduce', async () => {
    let i = 0;
    const r = await verifyScenario({
      scenario: SCENARIO,
      run_id: 'run-b',
      attempts: 3,
      probeRunner: async (p) => ({ probe_id: p.id, status: i++ === 1 ? 401 : 200 }),
    });
    assert.equal(r.deterministic, false);
    assert.equal(r.successes, 2);
  });

  it('deterministic=false when every attempt fails differently', async () => {
    let status = 500;
    const r = await verifyScenario({
      scenario: SCENARIO,
      run_id: 'run-different-failures',
      attempts: 2,
      probeRunner: async (p) => ({ probe_id: p.id, status: status++ }),
    });
    assert.equal(r.successes, 1);
    assert.equal(r.deterministic, false);
    assert.notEqual(
      r.attempts_detail[0]?.failure_fingerprint,
      r.attempts_detail[1]?.failure_fingerprint,
    );
  });

  it('anchors replay success to the original fingerprint when supplied', async () => {
    const r = await verifyScenario({
      scenario: SCENARIO,
      run_id: 'run-original-fingerprint',
      attempts: 3,
      expected_fingerprint: 'original-finding-fingerprint',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
    });
    assert.equal(r.successes, 0);
    assert.equal(r.deterministic, false);
    assert.equal(r.fingerprint, 'original-finding-fingerprint');
  });

  it('throws on attempts < 1', async () => {
    await assert.rejects(
      () =>
        verifyScenario({
          scenario: SCENARIO,
          run_id: 'run-x',
          attempts: 0,
          probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
        }),
      /attempts must be >= 1/,
    );
  });
});
