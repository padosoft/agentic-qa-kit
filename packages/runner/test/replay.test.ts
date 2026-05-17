import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
