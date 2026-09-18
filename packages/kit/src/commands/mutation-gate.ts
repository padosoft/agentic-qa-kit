import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type MutationReport,
  type MutationThresholdResult,
  evaluateMutationThreshold,
  parseMutationSummary,
} from '@aqa/ingest';

export interface MutationGateOptions {
  root: string;
  inputFile: string;
  minScore: number;
}

export interface MutationGateResult {
  ok: boolean;
  gate_ok: boolean;
  input_path: string;
  report?: MutationReport;
  threshold?: MutationThresholdResult;
  error?: string;
}

/** Evaluate an externally-produced mutation report without executing a mutator. */
export function runMutationGate(options: MutationGateOptions): MutationGateResult {
  const inputPath = resolve(options.root, options.inputFile);
  try {
    const report = parseMutationSummary(
      JSON.parse(readFileSync(inputPath, 'utf8')) as unknown,
      options.inputFile,
    );
    const threshold = evaluateMutationThreshold(report, options.minScore);
    return { ok: true, gate_ok: threshold.passed, input_path: inputPath, report, threshold };
  } catch (error) {
    return {
      ok: false,
      gate_ok: false,
      input_path: inputPath,
      error: error instanceof Error ? error.message : 'invalid mutation report',
    };
  }
}
