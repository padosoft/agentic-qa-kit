import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type CalibrationReport, calibrateAgentJudges } from '@aqa/runner';

const MAX_SAMPLES = 100_000;

export interface OracleCalibrationOptions {
  root: string;
  inputFile: string;
  binCount?: number;
  maxEce?: number;
}

export interface OracleCalibrationResult {
  ok: boolean;
  gate_ok: boolean;
  input_path: string;
  report?: CalibrationReport;
  error?: string;
}

/** Calibrate opaque judge scores against a reviewed, redacted gold corpus. */
export function runOracleCalibration(options: OracleCalibrationOptions): OracleCalibrationResult {
  const inputPath = resolve(options.root, options.inputFile);
  try {
    const corpus = parseCorpus(JSON.parse(readFileSync(inputPath, 'utf8')));
    const binCount = options.binCount ?? 10;
    const report = calibrateAgentJudges(corpus.samples, binCount);
    const gateOk =
      options.maxEce === undefined || report.expected_calibration_error <= options.maxEce;
    return { ok: true, gate_ok: gateOk, input_path: inputPath, report };
  } catch (error) {
    return {
      ok: false,
      gate_ok: false,
      input_path: inputPath,
      error: error instanceof Error ? error.message : 'invalid calibration corpus',
    };
  }
}

function parseCorpus(value: unknown): {
  samples: ReadonlyArray<{ predicted: number; expected: boolean }>;
} {
  const root = record(value, 'calibration corpus');
  exactKeys(root, ['schema_version', 'corpus_id', 'samples'], 'calibration corpus');
  if (root.schema_version !== '1') throw new Error('calibration corpus schema_version must be "1"');
  text(root.corpus_id, 'calibration corpus corpus_id');
  if (!Array.isArray(root.samples) || root.samples.length === 0)
    throw new Error('calibration corpus samples must be a non-empty array');
  if (root.samples.length > MAX_SAMPLES)
    throw new Error(`calibration corpus exceeds ${MAX_SAMPLES} samples`);
  const ids = new Set<string>();
  return {
    samples: root.samples.map((sample, index) => {
      const item = record(sample, `calibration sample ${index}`);
      exactKeys(item, ['sample_id', 'predicted', 'expected'], `calibration sample ${index}`);
      const sampleId = text(item.sample_id, `calibration sample ${index} sample_id`);
      if (ids.has(sampleId)) throw new Error(`duplicate calibration sample_id: ${sampleId}`);
      ids.add(sampleId);
      if (typeof item.predicted !== 'number' || !Number.isFinite(item.predicted))
        throw new Error(`calibration sample ${sampleId} predicted must be a finite number`);
      if (typeof item.expected !== 'boolean')
        throw new Error(`calibration sample ${sampleId} expected must be boolean`);
      return { predicted: item.predicted, expected: item.expected };
    }),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index]))
    throw new Error(`${label} contains unsupported or missing fields`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${label} must be non-empty`);
  return value.trim();
}
