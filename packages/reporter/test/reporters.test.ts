import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderJson } from '../dist/json.js';
import { renderMarkdown } from '../dist/markdown.js';

const RUN = {
  schema_version: '1' as const,
  id: 'run-1',
  started_at: '2026-05-17T10:00:00Z',
  finished_at: '2026-05-17T10:05:00Z',
  state: 'succeeded' as const,
  project: 'demo',
  profile: 'smoke',
  execution_mode: 'orchestrator' as const,
  config_snapshot: {
    profile: 'smoke',
    execution_mode: 'orchestrator' as const,
    packs: [],
    config_hash: 'a'.repeat(64),
  },
  totals: {
    scenarios: 3,
    findings: 2,
    probes: 6,
    llm_tokens_in: 1000,
    llm_tokens_out: 100,
    llm_cost_usd: 0.12,
  },
  artifact_dir: '.aqa/runs/run-1',
};

const FINDINGS = [
  {
    schema_version: '1' as const,
    id: 'AQA-2026-0001',
    run_id: 'run-1',
    scenario_id: 'scn-a',
    risk_id: 'r-a',
    title: 'high one',
    summary: 'Oracle failed: expected 401 got 200',
    severity: 'high' as const,
    status: 'draft' as const,
    execution_mode: 'orchestrator' as const,
    discovered_at: '2026-05-17T10:01:00Z',
    confidence: 0.8,
    confidence_components: {},
    reproducibility: {},
    verification_floor: 'scenario_level' as const,
    evidence: ['replay/repro.sh'],
    tags: [],
  },
  {
    schema_version: '1' as const,
    id: 'AQA-2026-0002',
    run_id: 'run-1',
    scenario_id: 'scn-b',
    risk_id: 'r-b',
    title: 'critical one',
    summary: 'Critical: input not validated',
    severity: 'critical' as const,
    status: 'draft' as const,
    execution_mode: 'orchestrator' as const,
    discovered_at: '2026-05-17T10:02:00Z',
    confidence: 0.95,
    confidence_components: {},
    reproducibility: {},
    verification_floor: 'scenario_level' as const,
    evidence: [],
    tags: [],
  },
];

describe('renderMarkdown', () => {
  it('orders findings by severity (critical before high)', () => {
    const md = renderMarkdown({ run: RUN, findings: FINDINGS });
    const idxCritical = md.indexOf('critical one');
    const idxHigh = md.indexOf('high one');
    assert.ok(idxCritical > -1 && idxHigh > -1);
    assert.ok(idxCritical < idxHigh, 'critical must appear before high');
  });

  it('renders "no findings" when empty', () => {
    const md = renderMarkdown({ run: RUN, findings: [] });
    assert.match(md, /No findings/);
  });

  it('includes run header + totals', () => {
    const md = renderMarkdown({ run: RUN, findings: FINDINGS });
    assert.match(md, /run-1/);
    assert.match(md, /\$0\.12/);
  });
});

describe('renderJson', () => {
  it('returns a stable shape with summary', () => {
    const j = renderJson({ run: RUN, findings: FINDINGS }, new Date('2026-05-17T10:10:00Z'));
    assert.equal(j.schema_version, '1');
    assert.equal(j.summary.total, 2);
    assert.equal(j.summary.severities.critical, 1);
    assert.equal(j.summary.severities.high, 1);
    assert.equal(j.run.id, 'run-1');
  });
});
