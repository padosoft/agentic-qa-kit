import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMinimizedCounterexampleReplay } from '../dist/counterexample.js';
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

const STRUCTURED_PW_SCENARIO = {
  ...HTTP_SCENARIO,
  steps: [
    {
      id: 'p1',
      kind: 'playwright' as const,
      with: {
        url: '/login',
        actions: [
          { type: 'fill', selector: '#email', value: 'qa@example.test' },
          { type: 'click', selector: 'button[type="submit"]' },
          { type: 'wait_for', selector: '[data-testid="account"]' },
        ],
      },
      timeout_ms: 30000,
    },
  ],
};

describe('minimized counterexample replay', () => {
  it('binds a bounded, redacted shrink result to finding evidence', async () => {
    const result = await buildMinimizedCounterexampleReplay({
      finding: FINDING,
      scenario: HTTP_SCENARIO,
      counterexample: {
        irrelevant: 'remove-me',
        nested: { keep: 'failure', token: 'secret=do-not-leak' },
      },
      stillFails: (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        'nested' in candidate,
      options: { max_attempts: 100, max_reductions: 10 },
    });
    assert.equal(result.artifact.path, 'replay/counterexample.min.json');
    assert.equal(result.finding_evidence, result.artifact.path);
    assert.match(result.artifact.contents, /AQA-2026-0001/);
    assert.doesNotMatch(result.artifact.contents, /do-not-leak/);
    assert.ok(result.reductions > 0);
  });
});

const SQL_SCENARIO = {
  ...HTTP_SCENARIO,
  steps: [
    {
      id: 'p1',
      kind: 'sql' as const,
      with: { query: 'SELECT id FROM orders WHERE customer_id = $1', params: ['customer-1'] },
      timeout_ms: 30000,
    },
  ],
};

describe('buildReplayArtifacts', () => {
  it('emits repro.sh + repro.curl for HTTP scenarios', () => {
    const out = buildReplayArtifacts({
      finding: FINDING,
      scenario: {
        ...HTTP_SCENARIO,
        steps: [
          {
            ...HTTP_SCENARIO.steps[0],
            with: { ...HTTP_SCENARIO.steps[0].with, body: { note: "O'Reilly" } },
          },
        ],
      },
      base_url: 'https://shop.example.test',
    });
    const paths = out.map((a) => a.path).sort();
    assert.deepEqual(paths, ['replay/repro.curl', 'replay/repro.sh']);
    const sh = out.find((a) => a.path === 'replay/repro.sh');
    assert.match(sh?.contents ?? '', /curl/);
    assert.match(sh?.contents ?? '', /'POST' 'https:\/\/shop\.example\.test\/items'/);
    assert.match(sh?.contents ?? '', /O'.*Reilly/);
    assert.match(sh?.contents ?? '', /AQA-2026-0001/);
  });

  it('emits repro.playwright.ts for Playwright scenarios', () => {
    const out = buildReplayArtifacts({ finding: FINDING, scenario: PW_SCENARIO });
    const paths = out.map((a) => a.path);
    assert.ok(paths.includes('replay/repro.playwright.ts'));
    assert.match(out[0]?.contents ?? '', /external script/);
  });

  it('emits executable structured Playwright actions', () => {
    const out = buildReplayArtifacts({
      finding: FINDING,
      scenario: STRUCTURED_PW_SCENARIO,
      base_url: 'https://shop.example.test',
    });
    const artifact = out.find((item) => item.kind === 'playwright');
    assert.match(artifact?.contents ?? '', /page\.goto\("https:\/\/shop\.example\.test\/login"/);
    assert.match(artifact?.contents ?? '', /page\.fill\("#email", "qa@example\.test"/);
    assert.doesNotMatch(artifact?.contents ?? '', /test\.skip/);
  });

  it('emits a read-only parameterized SQL replay', () => {
    const artifact = buildReplayArtifacts({ finding: FINDING, scenario: SQL_SCENARIO }).find(
      (item) => item.kind === 'sql',
    );
    assert.match(artifact?.contents ?? '', /SET TRANSACTION READ ONLY/);
    assert.match(artifact?.contents ?? '', /PREPARE aqa_replay/);
    assert.match(artifact?.contents ?? '', /EXECUTE aqa_replay\('customer-1'\)/);
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
