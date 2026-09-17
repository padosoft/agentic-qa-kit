import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runIngest } from '../dist/commands/ingest.js';

describe('aqa ingest', () => {
  it('writes redacted JUnit evidence under .aqa/ingest', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-ingest-'));
    const input = join(root, 'junit.xml');
    writeFileSync(
      input,
      '<testsuite><testcase name="x"><failure>Bearer abc-secret</failure></testcase></testsuite>',
    );
    const result = runIngest({ root, kind: 'junit', file: input });
    assert.equal(result.ok, true);
    assert.match(result.artifact_path ?? '', /\.aqa[\\/]ingest/);
    const evidence = readFileSync(join(root, result.artifact_path ?? ''), 'utf8');
    assert.doesNotMatch(evidence, /abc-secret/);
    assert.match(evidence, /REDACTED/);
  });

  it('fails closed for malformed JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-ingest-'));
    const input = join(root, 'bad.json');
    writeFileSync(input, '{not-json');
    const result = runIngest({ root, kind: 'sast', file: input });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /JSON|position/i);
  });

  it('ingests k6 and Locust summaries through the CLI command boundary', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-ingest-'));
    const k6 = join(root, 'k6.json');
    const locust = join(root, 'locust.json');
    writeFileSync(
      k6,
      JSON.stringify({ metrics: { http_req_duration: { values: { 'p(95)': 12 } } } }),
    );
    writeFileSync(
      locust,
      JSON.stringify({ stats: [{ name: '/health', num_requests: 2, num_failures: 0 }] }),
    );
    const k6Result = runIngest({ root, kind: 'k6', file: k6 });
    const locustResult = runIngest({ root, kind: 'locust', file: locust });
    assert.equal(k6Result.report?.framework, 'k6');
    assert.equal(locustResult.report?.framework, 'locust');
    assert.equal(k6Result.ok, true);
    assert.equal(locustResult.ok, true);
  });
});
