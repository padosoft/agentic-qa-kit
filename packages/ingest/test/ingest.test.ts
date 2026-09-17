import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluatePerformanceThresholds,
  parseJunit,
  parseK6Summary,
  parseLocustSummary,
  parseSast,
} from '../dist/index.js';

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
});
