/**
 * Tests for the in-browser findings clusterer. Mirrors `@aqa/clustering` but
 * uses Web Crypto for hashing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clusterFindings, signatureOf } from '../src/data/cluster.ts';
import type { MockFinding } from '../src/data/mock.ts';

function f(overrides: Partial<MockFinding>): MockFinding {
  return {
    id: 'f-x',
    run_id: 'run-x',
    severity: 'medium',
    status: 'draft',
    scenario_id: 'sc-x',
    risk_id: 'r-x',
    summary: 'summary',
    verification_floor: 'bug_level',
    created_at: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

describe('signatureOf', () => {
  it('is identical for findings with the same scenario/risk/summary', async () => {
    const a = await signatureOf(f({ id: 'a' }));
    const b = await signatureOf(f({ id: 'b' }));
    assert.equal(a, b);
  });

  it('normalises whitespace + case in summary', async () => {
    const a = await signatureOf(f({ summary: 'Hello   World' }));
    const b = await signatureOf(f({ summary: 'hello world' }));
    assert.equal(a, b);
  });

  it('differs when scenario or risk differs', async () => {
    const base = await signatureOf(f({}));
    const otherScenario = await signatureOf(f({ scenario_id: 'sc-other' }));
    const otherRisk = await signatureOf(f({ risk_id: 'r-other' }));
    assert.notEqual(base, otherScenario);
    assert.notEqual(base, otherRisk);
  });
});

describe('clusterFindings', () => {
  it('groups duplicates and picks earliest as representative', async () => {
    const earlier = f({ id: 'a', created_at: '2026-05-18T00:00:00Z' });
    const later = f({ id: 'b', created_at: '2026-05-18T01:00:00Z' });
    const clusters = await clusterFindings([later, earlier]);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]?.count, 2);
    assert.equal(clusters[0]?.representative.id, 'a');
  });

  it('promotes worst severity across cluster members', async () => {
    const lo = f({ id: 'lo', severity: 'low' });
    const hi = f({ id: 'hi', severity: 'critical' });
    const clusters = await clusterFindings([lo, hi]);
    assert.equal(clusters[0]?.worst_severity, 'critical');
  });

  it('sorts clusters by worst severity descending', async () => {
    const lo = f({ id: 'lo', severity: 'low', scenario_id: 'sc-1' });
    const hi = f({ id: 'hi', severity: 'critical', scenario_id: 'sc-2' });
    const clusters = await clusterFindings([lo, hi]);
    assert.equal(clusters[0]?.worst_severity, 'critical');
    assert.equal(clusters[1]?.worst_severity, 'low');
  });
});
