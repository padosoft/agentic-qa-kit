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
  it('scopes an oracle to its declared probe instead of the last response', () => {
    const r = evaluateOracle(
      { id: 'o-target', kind: 'http_status', probe_id: 'p1', with: { expected: 201 }, weight: 1 },
      {
        probes: [
          { probe_id: 'p1', status: 201 },
          { probe_id: 'p2', status: 500 },
        ],
      },
    );
    assert.equal(r.passed, true);
  });

  it('fails closed when an oracle references a missing probe', () => {
    const r = evaluateOracle(
      {
        id: 'o-missing',
        kind: 'response_contains',
        probe_id: 'p-missing',
        with: { value: 'ok' },
        weight: 1,
      },
      { probes: [{ probe_id: 'p1', body: 'ok' }] },
    );
    assert.equal(r.passed, false);
    assert.match(r.reason, /missing probe/);
  });

  it('compares a response JSON path with a prior probe output', () => {
    const r = evaluateOracle(
      {
        id: 'o-same-id',
        kind: 'response_contains',
        probe_id: 'p2',
        with: { jsonpath: '$.id', equals: '@p1.body.id' },
        weight: 1,
      },
      {
        probes: [
          { probe_id: 'p1', body: { id: 'item-1' } },
          { probe_id: 'p2', body: { id: 'item-1' } },
        ],
      },
    );
    assert.equal(r.passed, true);
  });

  it('fails closed for an unsupported equality shape instead of matching an empty string', () => {
    const r = evaluateOracle(
      {
        id: 'o-invalid',
        kind: 'response_contains',
        with: { jsonpath: '$.missing', equals: '@missing.body.id' },
        weight: 1,
      },
      { probes: [{ probe_id: 'p1', body: { id: 'item-1' } }] },
    );
    assert.equal(r.passed, false);
  });
  it('response_not_contains rejects forbidden string', () => {
    const r = evaluateOracle(
      { id: 'o-no-pwned', kind: 'response_not_contains', with: { value: 'PWNED' }, weight: 1 },
      { probes: [{ probe_id: 'p1', status: 200, body: 'I am PWNED' }] },
    );
    assert.equal(r.passed, false);
  });

  it('response_not_contains fails closed when the probe has a transport error', () => {
    const r = evaluateOracle(
      { id: 'o-no-error', kind: 'response_not_contains', with: { value: 'PWNED' }, weight: 1 },
      { probes: [{ probe_id: 'p1', error: 'synthetic transport unavailable' }] },
    );
    assert.equal(r.passed, false);
    assert.match(r.reason, /transport error/i);
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
