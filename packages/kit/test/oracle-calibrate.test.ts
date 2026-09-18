import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runOracleCalibration } from '../dist/commands/oracle-calibrate.js';

function corpus(samples: unknown[]): string {
  return JSON.stringify({ schema_version: '1', corpus_id: 'gold-1', samples });
}

test('oracle calibration computes a report and enforces the ECE gate', () => {
  const root = mkdtempSync(join(tmpdir(), 'aqa-calibration-'));
  const path = join(root, 'gold.json');
  writeFileSync(
    path,
    corpus([
      { sample_id: 'a', predicted: 0.9, expected: true },
      { sample_id: 'b', predicted: 0.1, expected: false },
    ]),
  );
  const result = runOracleCalibration({ root, inputFile: 'gold.json', maxEce: 0.1 });
  assert.equal(result.ok, true);
  assert.equal(result.gate_ok, true);
  assert.equal(result.report?.samples, 2);
});

test('oracle calibration rejects rationale leakage and unknown fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'aqa-calibration-'));
  const path = join(root, 'unsafe.json');
  writeFileSync(
    path,
    corpus([{ sample_id: 'a', predicted: 0.9, expected: true, rationale: 'secret' }]),
  );
  const result = runOracleCalibration({ root, inputFile: 'unsafe.json' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /unsupported or missing fields/);
});

test('oracle calibration returns a release-gate failure when ECE exceeds threshold', () => {
  const root = mkdtempSync(join(tmpdir(), 'aqa-calibration-'));
  const path = join(root, 'bad.json');
  writeFileSync(
    path,
    corpus([
      { sample_id: 'a', predicted: 0.9, expected: false },
      { sample_id: 'b', predicted: 0.9, expected: false },
    ]),
  );
  const result = runOracleCalibration({ root, inputFile: 'bad.json', maxEce: 0.1 });
  assert.equal(result.ok, true);
  assert.equal(result.gate_ok, false);
});
