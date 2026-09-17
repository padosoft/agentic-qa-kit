import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseJunit, parseSast } from '../dist/index.js';

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
