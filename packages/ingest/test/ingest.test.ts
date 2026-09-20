import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
  evaluateMutationCoverage,
  evaluateMutationHoldoutRegressionEvidence,
  evaluateMutationRegressionEvidence,
  evaluateMutationThreshold,
  evaluatePerformanceThresholds,
  parseJunit,
  parseK6Summary,
  parseLocustSummary,
  parseMutationCoverageManifest,
  parseMutationRegressionEvidence,
  parseMutationSummary,
  parsePlaywrightTrace,
  parseSast,
  splitMutationCoverageHoldout,
} from '../dist/index.js';

describe('mutation regression evidence', () => {
  const report = parseMutationSummary({
    mutants: [
      { id: 'm-1', file: 'cart.ts', operator: 'condition', status: 'Killed' },
      { id: 'm-2', file: 'cart.ts', operator: 'condition', status: 'Survived' },
    ],
  });
  const manifest = parseMutationCoverageManifest({
    schema_version: '1',
    links: [
      { mutation_id: 'm-1', risk_ids: ['cart'], scenario_ids: ['checkout'] },
      { mutation_id: 'm-2', risk_ids: ['cart'], scenario_ids: ['checkout'] },
    ],
  });

  it('passes only when observed runs explain the mutation report', () => {
    const evidence = parseMutationRegressionEvidence({
      schema_version: '1',
      source_revision: 'abc123',
      observations: [
        { mutation_id: 'm-1', scenario_id: 'checkout', run_id: 'run-1', outcome: 'killed' },
        { mutation_id: 'm-2', scenario_id: 'checkout', run_id: 'run-2', outcome: 'survived' },
      ],
    });
    const result = evaluateMutationRegressionEvidence(report, manifest, evidence, 0.5);
    assert.equal(result.passed, true);
    assert.equal(result.observed_pairs, 2);
    assert.equal(result.kill_rate, 0.5);
  });

  it('fails closed for missing or contradictory execution evidence', () => {
    const evidence = parseMutationRegressionEvidence({
      schema_version: '1',
      source_revision: 'abc123',
      observations: [
        { mutation_id: 'm-1', scenario_id: 'checkout', run_id: 'run-1', outcome: 'survived' },
      ],
    });
    const result = evaluateMutationRegressionEvidence(report, manifest, evidence, 0);
    assert.equal(result.passed, false);
    assert.deepEqual(result.missing_pairs, ['m-2:checkout']);
    assert.deepEqual(result.mismatched_mutant_ids, ['m-1']);
  });
});

function traceZip(content: string, method: 0 | 8 = 8): Uint8Array {
  const name = Buffer.from('trace.trace');
  const raw = Buffer.from(content, 'utf8');
  const body = method === 0 ? raw : deflateRawSync(raw);
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(name.length, 26);
  name.copy(header, 30);
  return Buffer.concat([header, body]);
}

describe('JUnit ingestion', () => {
  it('normalizes pass, failure, error and skipped cases', () => {
    const report = parseJunit(`<?xml version="1.0"?><testsuite name="unit">
      <testcase classname="Cart" name="adds item" time="0.012"/>
      <testcase classname="Cart" name="rejects bad coupon"><failure>Bearer secret-token</failure></testcase>
      <testcase classname="Cart" name="db unavailable"><error>down</error></testcase>
      <testcase classname="Cart" name="slow"><skipped/></testcase>
    </testsuite>`);
    assert.deepEqual(
      report.records.map((record) => record.status),
      ['passed', 'failed', 'error', 'skipped'],
    );
    assert.equal(report.records[0]?.duration_ms, 12);
    assert.equal(report.records[1]?.suite, 'Cart');
    assert.ok(report.records[1]?.fingerprint.length === 64);
  });

  it('rejects XXE declarations and documents without testcases', () => {
    assert.throws(
      () => parseJunit('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuite/>'),
      /DOCTYPE|ENTITY/,
    );
    assert.throws(() => parseJunit('<testsuite name="empty"></testsuite>'), /no testcase/i);
  });
});

describe('SAST ingestion', () => {
  it('normalizes Semgrep-compatible results and preserves warnings', () => {
    const report = parseSast(
      {
        results: [
          {
            check_id: 'javascript.lang.security.detect-eval-with-expression',
            path: 'src/app.ts',
            start: { line: 42 },
            extra: { severity: 'ERROR', message: 'avoid eval' },
          },
        ],
        errors: ['one shard was unavailable'],
      },
      'semgrep.json',
      'semgrep',
    );
    assert.equal(report.records[0]?.status, 'failed');
    assert.equal(report.records[0]?.line, 42);
    assert.equal(
      report.records[0]?.rule_id,
      'javascript.lang.security.detect-eval-with-expression',
    );
    assert.deepEqual(report.warnings, ['one shard was unavailable']);
  });

  it('fails closed on malformed or ambiguous SAST input', () => {
    assert.throws(() => parseSast([]), /object/);
    assert.throws(() => parseSast({ results: [{}] }), /check_id/);
  });
});

describe('k6 ingestion', () => {
  it('normalizes p95 latency and fails checks or request errors', () => {
    const report = parseK6Summary({
      metrics: {
        http_req_duration: { values: { avg: 42.1, 'p(95)': 120.456 } },
        http_req_failed: { values: { rate: 0.02 } },
        checks: { values: { rate: 0.98, passes: 98, fails: 2 } },
      },
    });
    assert.equal(report.framework, 'k6');
    assert.equal(report.records[0]?.duration_ms, 120.456);
    assert.equal(report.records[1]?.measurements?.rate, 0.02);
    assert.equal(report.records[1]?.measurements?.failure_rate, 0.02);
    assert.equal(report.records[2]?.measurements?.check_rate, 0.98);
    assert.deepEqual(
      report.records.map((record) => record.status),
      ['passed', 'failed', 'failed'],
    );
    assert.ok(report.records.every((record) => record.fingerprint.length === 64));
  });

  it('fails closed for a missing or non-numeric metrics summary', () => {
    assert.throws(() => parseK6Summary({}), /metrics/);
    assert.throws(
      () => parseK6Summary({ metrics: { checks: { values: { rate: '0.9' } } } }),
      /numeric metrics/,
    );
  });
});

describe('Locust ingestion', () => {
  it('normalizes request statistics, p95 and failures', () => {
    const report = parseLocustSummary({
      stats: [
        {
          method: 'GET',
          name: '/checkout',
          num_requests: 100,
          num_failures: 3,
          response_time_percentiles: { '0.95': 245.5 },
        },
      ],
      errors: ['one worker disconnected'],
    });
    assert.equal(report.framework, 'locust');
    assert.equal(report.records[0]?.name, 'GET /checkout');
    assert.equal(report.records[0]?.duration_ms, 245.5);
    assert.equal(report.records[0]?.status, 'failed');
    assert.deepEqual(report.warnings, ['one worker disconnected']);
    assert.equal(report.records[0]?.measurements?.failure_rate, 0.03);
  });

  it('fails closed on malformed Locust stats', () => {
    assert.throws(() => parseLocustSummary({ stats: [] }), /no stats/);
    assert.throws(
      () => parseLocustSummary({ stats: [{ name: '/health', num_requests: -1, num_failures: 0 }] }),
      /num_requests/,
    );
  });
});

describe('Playwright trace ingestion', () => {
  it('normalizes action metadata and failure state without retaining URLs or payloads', () => {
    const report = parsePlaywrightTrace(
      traceZip(
        [
          JSON.stringify({
            type: 'action',
            metadata: { id: 'call-1', apiName: 'page.goto', wallTime: 10 },
          }),
          JSON.stringify({
            type: 'after',
            metadata: {
              id: 'call-1',
              startTime: 10,
              endTime: 25,
              error: {
                message: 'assertion failed at https://secret.example/token=secret-value',
              },
              url: 'https://secret.example/token=redacted',
            },
          }),
        ].join('\n'),
      ),
    );
    assert.equal(report.framework, 'playwright');
    assert.equal(report.records.length, 1);
    assert.equal(report.records[0]?.status, 'failed');
    assert.equal(report.records[0]?.duration_ms, 15);
    assert.equal(report.records[0]?.message, 'assertion failed at [redacted-url]');
    assert.equal(JSON.stringify(report).includes('secret.example'), false);
  });

  it('rejects malformed or unsafe trace archives', () => {
    assert.throws(() => parsePlaywrightTrace(Buffer.from('not a zip')), /missing trace\.trace/i);
    const unsafe = traceZip(JSON.stringify({ type: 'action', metadata: { id: 'x' } }));
    const unsafeBuffer = Buffer.from(unsafe);
    unsafeBuffer.write('..\\trace.tr', 30, 'utf8');
    assert.throws(() => parsePlaywrightTrace(unsafeBuffer), /unsafe entry name/i);
  });
});

describe('performance threshold policy', () => {
  it('evaluates explicit thresholds without changing imported evidence', () => {
    const report = parseLocustSummary({
      stats: [
        {
          name: '/checkout',
          num_requests: 10,
          num_failures: 1,
          response_time_percentiles: { '0.95': 250 },
        },
      ],
    });
    const result = evaluatePerformanceThresholds(report, {
      max_p95_ms: 200,
      max_failure_rate: 0.05,
    });
    assert.equal(result.passed, false);
    assert.deepEqual(
      result.violations.map((violation) => violation.metric),
      ['p95_ms', 'failure_rate'],
    );
    assert.equal(report.records[0]?.status, 'failed');
  });

  it('fails closed for an empty or invalid policy', () => {
    const report = parseK6Summary({ metrics: { http_req_duration: { values: { 'p(95)': 10 } } } });
    assert.throws(() => evaluatePerformanceThresholds(report, {}), /empty/);
    assert.throws(() => evaluatePerformanceThresholds(report, { min_check_rate: 2 }), /invalid/);
  });

  it('evaluates k6 failure and check rate semantics', () => {
    const report = parseK6Summary({
      metrics: {
        http_req_failed: { values: { rate: 0.2 } },
        checks: { values: { rate: 0.8 } },
      },
    });
    const result = evaluatePerformanceThresholds(report, {
      max_failure_rate: 0.05,
      min_check_rate: 0.95,
    });
    assert.equal(result.passed, false);
    assert.deepEqual(
      result.violations.map((violation) => violation.metric),
      ['failure_rate', 'check_rate'],
    );
  });
});

describe('mutation evidence', () => {
  it('normalizes flat and Stryker-style reports and excludes ignored mutants', () => {
    const report = parseMutationSummary({
      files: {
        'src/cart.ts': {
          mutants: [
            { id: '1', mutatorName: 'Arithmetic', status: 'Killed' },
            { id: '2', mutatorName: 'ConditionalExpression', status: 'Survived' },
            { id: '3', mutatorName: 'StringLiteral', status: 'NoCoverage' },
            { id: '4', mutatorName: 'Ignored', status: 'Ignored' },
          ],
        },
      },
    });
    assert.equal(report.mutation_score, 0.333333);
    assert.deepEqual(report.totals, {
      killed: 1,
      survived: 1,
      no_coverage: 1,
      timeout: 0,
      runtime_error: 0,
      compile_error: 0,
      ignored: 1,
    });
    assert.equal(evaluateMutationThreshold(report, 0.3).passed, true);
    assert.equal(evaluateMutationThreshold(report, 0.4).passed, false);
  });

  it('fails closed for malformed, duplicate and unsupported mutation evidence', () => {
    assert.throws(() => parseMutationSummary({ mutants: [] }), /between 1 and 100000/);
    assert.throws(
      () =>
        parseMutationSummary({
          mutants: [
            { id: 'same', file: 'a.ts', status: 'Killed' },
            { id: 'same', file: 'a.ts', status: 'Killed' },
          ],
        }),
      /duplicate/,
    );
    assert.throws(
      () => parseMutationSummary({ mutants: [{ id: '1', file: 'a.ts', status: 'Unknown' }] }),
      /unsupported/,
    );
    assert.throws(
      () =>
        evaluateMutationThreshold(
          parseMutationSummary({ mutants: [{ id: '1', file: 'a.ts', status: 'Killed' }] }),
          1.1,
        ),
      /between 0 and 1/,
    );
  });
});

describe('mutation to regression coverage', () => {
  it('creates a deterministic digest-bound train/holdout split with minimums', () => {
    const input = parseMutationCoverageManifest({
      schema_version: '1',
      links: Array.from({ length: 10 }, (_, index) => ({
        mutation_id: `m-${index}`,
        risk_ids: ['risk-cart'],
        scenario_ids: ['scenario-cart'],
      })),
    });
    const first = splitMutationCoverageHoldout(input, {
      holdout_rate: 0.3,
      split_key: 'project-a:revision-1',
      min_train_links: 2,
      min_holdout_links: 2,
    });
    const second = splitMutationCoverageHoldout(input, {
      holdout_rate: 0.3,
      split_key: 'project-a:revision-1',
      min_train_links: 2,
      min_holdout_links: 2,
    });
    assert.deepEqual(second, first);
    assert.equal(first.train.links.length, 7);
    assert.equal(first.holdout.links.length, 3);
    assert.equal(new Set(first.holdout.links.map((link) => link.mutation_id)).size, 3);
    assert.notEqual(first.plan_digest, '');
    assert.throws(
      () => splitMutationCoverageHoldout(input, { holdout_rate: 0.5, split_key: '' }),
      /options/,
    );
  });

  it('requires regression evidence to carry the exact holdout plan digest', () => {
    const report = parseMutationSummary({
      mutants: [
        { id: 'm-1', file: 'cart.ts', operator: 'A', status: 'Killed' },
        { id: 'm-2', file: 'cart.ts', operator: 'B', status: 'Killed' },
      ],
    });
    const split = splitMutationCoverageHoldout(
      parseMutationCoverageManifest({
        schema_version: '1',
        links: [
          { mutation_id: 'm-1', risk_ids: ['cart'], scenario_ids: ['checkout'] },
          { mutation_id: 'm-2', risk_ids: ['cart'], scenario_ids: ['checkout'] },
        ],
      }),
      { holdout_rate: 0.5, split_key: 'project-a:revision-2' },
    );
    const evidence = parseMutationRegressionEvidence({
      schema_version: '1',
      source_revision: 'revision-2',
      plan_digest: split.plan_digest,
      observations: split.holdout.links.map((link, index) => ({
        mutation_id: link.mutation_id,
        scenario_id: 'checkout',
        run_id: `holdout-run-${index}`,
        outcome: 'killed',
      })),
    });
    assert.equal(
      evaluateMutationHoldoutRegressionEvidence(report, split, evidence, 1).passed,
      true,
    );
    assert.throws(
      () =>
        evaluateMutationHoldoutRegressionEvidence(
          report,
          split,
          { ...evidence, plan_digest: 'different-plan' },
          1,
        ),
      /plan_digest/,
    );
  });

  it('requires reviewed mutant-to-risk/scenario links and reports per-risk kill rates', () => {
    const report = parseMutationSummary({
      mutants: [
        { id: 'm-1', file: 'src/cart.ts', operator: 'A', status: 'Killed' },
        { id: 'm-2', file: 'src/cart.ts', operator: 'B', status: 'Survived' },
      ],
    });
    const manifest = parseMutationCoverageManifest({
      schema_version: '1',
      links: [
        { mutation_id: 'm-1', risk_ids: ['risk-cart'], scenario_ids: ['scenario-cart'] },
        { mutation_id: 'm-2', risk_ids: ['risk-cart'], scenario_ids: ['scenario-cart'] },
      ],
    });
    const result = evaluateMutationCoverage(report, manifest, {
      min_mapped_rate: 1,
      min_killed_rate: 0.5,
    });
    assert.equal(result.passed, true);
    assert.equal(result.risk_coverage[0]?.mutation_score, 0.5);
  });

  it('fails closed for unmapped mutants, unknown links and invalid manifests', () => {
    const report = parseMutationSummary({
      mutants: [
        { id: 'm-1', file: 'src/cart.ts', operator: 'A', status: 'Killed' },
        { id: 'm-2', file: 'src/cart.ts', operator: 'B', status: 'Survived' },
      ],
    });
    const manifest = parseMutationCoverageManifest({
      schema_version: '1',
      links: [{ mutation_id: 'm-1', risk_ids: ['risk-cart'], scenario_ids: ['scenario-cart'] }],
    });
    const result = evaluateMutationCoverage(report, manifest, {
      min_mapped_rate: 1,
      min_killed_rate: 1,
    });
    assert.equal(result.passed, false);
    assert.deepEqual(result.unmapped_mutant_ids, ['m-2']);
    assert.throws(() => parseMutationCoverageManifest({ schema_version: '1', links: [] }), /links/);
    assert.throws(
      () =>
        evaluateMutationCoverage(
          report,
          {
            schema_version: '1',
            links: [{ mutation_id: 'missing', risk_ids: ['r'], scenario_ids: ['s'] }],
          },
          { min_mapped_rate: 0, min_killed_rate: 0 },
        ),
      /unknown mutant/,
    );
  });
});
