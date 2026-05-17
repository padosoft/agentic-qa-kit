import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateOracle } from '../dist/oracles.js';

describe('builtInOracles', () => {
  it('http_status passes when last probe status matches', () => {
    const r = evaluateOracle(
      { id: 'o1', kind: 'http_status', with: { expected: 200 }, weight: 1 },
      { probes: [{ probe_id: 'p1', status: 200 }] },
    );
    assert.equal(r.passed, true);
    assert.equal(r.agreement, 1);
  });
  it('http_status fails when status differs', () => {
    const r = evaluateOracle(
      { id: 'o1', kind: 'http_status', with: { expected: 401 }, weight: 1 },
      { probes: [{ probe_id: 'p1', status: 200 }] },
    );
    assert.equal(r.passed, false);
    assert.equal(r.agreement, 0);
  });
  it('response_not_contains rejects forbidden string', () => {
    const r = evaluateOracle(
      { id: 'o-no-pwned', kind: 'response_not_contains', with: { value: 'PWNED' }, weight: 1 },
      { probes: [{ probe_id: 'p1', status: 200, body: 'I am PWNED' }] },
    );
    assert.equal(r.passed, false);
  });
  it('unknown oracle kind returns passed=false with a clear reason', () => {
    const r = evaluateOracle(
      // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard
      { id: 'ox', kind: 'made_up' as any, with: {}, weight: 1 },
      { probes: [] },
    );
    assert.equal(r.passed, false);
    assert.match(r.reason, /unknown oracle/);
  });
});
