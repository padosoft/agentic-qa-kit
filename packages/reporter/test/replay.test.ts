import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildReplayArtifacts } from '../dist/replay.js';

const FINDING = {
  schema_version: '1' as const,
  id: 'AQA-2026-0001',
  run_id: 'run-1',
  scenario_id: 'scn',
  risk_id: 'r',
  title: 't',
  summary: 's',
  severity: 'high' as const,
  status: 'draft' as const,
  execution_mode: 'orchestrator' as const,
  discovered_at: '2026-05-17T10:00:00Z',
  confidence: 0.5,
  confidence_components: {},
  reproducibility: {},
  verification_floor: 'scenario_level' as const,
  evidence: [],
  tags: [],
};

const HTTP_SCENARIO = {
  schema_version: '1' as const,
  id: 'scn',
  title: 'sample',
  risk_refs: ['r'],
  invariant_refs: [],
  preconditions: [],
  steps: [
    {
      id: 'p1',
      kind: 'http' as const,
      with: { method: 'POST', url: '/items', headers: { 'X-Idempotency': 'k' }, body: { a: 1 } },
      timeout_ms: 5000,
    },
  ],
  oracles: [{ id: 'o', kind: 'http_status' as const, with: { expected: 401 }, weight: 1 }],
  cleanup: [],
  tags: [],
};

const PW_SCENARIO = {
  ...HTTP_SCENARIO,
  steps: [
    {
      id: 'p1',
      kind: 'playwright' as const,
      with: { script: 'tests/x.spec.ts' },
      timeout_ms: 30000,
    },
  ],
};

describe('buildReplayArtifacts', () => {
  it('emits repro.sh + repro.curl for HTTP scenarios', () => {
    const out = buildReplayArtifacts({ finding: FINDING, scenario: HTTP_SCENARIO });
    const paths = out.map((a) => a.path).sort();
    assert.deepEqual(paths, ['replay/repro.curl', 'replay/repro.sh']);
    const sh = out.find((a) => a.path === 'replay/repro.sh');
    assert.match(sh?.contents ?? '', /curl/);
    assert.match(sh?.contents ?? '', /POST '\/items'/);
    assert.match(sh?.contents ?? '', /AQA-2026-0001/);
  });

  it('emits repro.playwright.ts for Playwright scenarios', () => {
    const out = buildReplayArtifacts({ finding: FINDING, scenario: PW_SCENARIO });
    const paths = out.map((a) => a.path);
    assert.ok(paths.includes('replay/repro.playwright.ts'));
  });

  it('emits no artifacts for an unsupported kind', () => {
    const scenario = {
      ...HTTP_SCENARIO,
      steps: [{ id: 'p1', kind: 'llm_eval' as const, with: {}, timeout_ms: 30000 }],
    };
    const out = buildReplayArtifacts({ finding: FINDING, scenario });
    assert.equal(out.length, 0);
  });
});
