import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clusterFindings, signatureOf } from '../dist/index.js';

const base = {
  schema_version: '1' as const,
  run_id: 'run-a',
  scenario_id: 'scn-1',
  risk_id: 'r-1',
  status: 'draft' as const,
  execution_mode: 'orchestrator' as const,
  confidence: 0.5,
  confidence_components: {},
  reproducibility: {},
  verification_floor: 'scenario_level' as const,
  evidence: [],
  tags: [],
};

describe('signatureOf', () => {
  it('two findings with the same scenario/risk/summary share a signature', () => {
    const a = {
      ...base,
      id: 'AQA-2026-0001',
      title: 't',
      summary: 'Token still valid 120s after rotation',
      severity: 'critical' as const,
      discovered_at: '2026-05-17T10:00:00Z',
    };
    const b = {
      ...base,
      id: 'AQA-2026-0002',
      run_id: 'run-b',
      title: 't',
      summary: 'Token still valid 999s after rotation',
      severity: 'critical' as const,
      discovered_at: '2026-05-17T11:00:00Z',
    };
    assert.equal(signatureOf(a), signatureOf(b));
  });

  it('different risks → different signatures', () => {
    const a = {
      ...base,
      id: 'AQA-2026-0001',
      title: 't',
      summary: 's',
      severity: 'high' as const,
      discovered_at: '2026-05-17T10:00:00Z',
    };
    const b = { ...a, risk_id: 'r-different' };
    assert.notEqual(signatureOf(a), signatureOf(b));
  });
});

describe('clusterFindings', () => {
  it('groups identical signatures and picks the earliest representative', () => {
    const fs = [
      {
        ...base,
        id: 'AQA-2026-0001',
        title: 't',
        summary: 'x',
        severity: 'high' as const,
        discovered_at: '2026-05-17T12:00:00Z',
      },
      {
        ...base,
        id: 'AQA-2026-0002',
        run_id: 'run-b',
        title: 't',
        summary: 'x',
        severity: 'high' as const,
        discovered_at: '2026-05-17T10:00:00Z',
      },
    ];
    const clusters = clusterFindings(fs);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]?.representative.id, 'AQA-2026-0002');
  });

  it('cluster severity is the worst among members', () => {
    const fs = [
      {
        ...base,
        id: 'AQA-2026-0001',
        title: 't',
        summary: 'x',
        severity: 'medium' as const,
        discovered_at: '2026-05-17T10:00:00Z',
      },
      {
        ...base,
        id: 'AQA-2026-0002',
        run_id: 'run-b',
        title: 't',
        summary: 'x',
        severity: 'critical' as const,
        discovered_at: '2026-05-17T11:00:00Z',
      },
    ];
    const clusters = clusterFindings(fs);
    assert.equal(clusters[0]?.severity, 'critical');
  });

  it('output is sorted by severity (critical first)', () => {
    const fs = [
      {
        ...base,
        id: 'AQA-2026-0001',
        scenario_id: 'a',
        risk_id: 'r-a',
        title: 't',
        summary: 's',
        severity: 'low' as const,
        discovered_at: '2026-05-17T10:00:00Z',
      },
      {
        ...base,
        id: 'AQA-2026-0002',
        scenario_id: 'b',
        risk_id: 'r-b',
        title: 't',
        summary: 's',
        severity: 'critical' as const,
        discovered_at: '2026-05-17T11:00:00Z',
      },
    ];
    const clusters = clusterFindings(fs);
    assert.equal(clusters[0]?.severity, 'critical');
    assert.equal(clusters[1]?.severity, 'low');
  });
});
