import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type MutationCoverageResult,
  type MutationReport,
  type MutationThresholdResult,
  evaluateMutationCoverage,
  evaluateMutationThreshold,
  parseMutationCoverageManifest,
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

export interface MutationCoverageGateOptions {
  root: string;
  inputFile: string;
  manifestFile: string;
  minMappedRate: number;
  minKilledRate: number;
}

export interface MutationCoverageGateResult {
  ok: boolean;
  gate_ok: boolean;
  input_path: string;
  manifest_path: string;
  coverage?: MutationCoverageResult;
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

/** Gate the mapping from external mutants to risk-linked regression scenarios. */
export function runMutationCoverageGate(
  options: MutationCoverageGateOptions,
): MutationCoverageGateResult {
  const inputPath = resolve(options.root, options.inputFile);
  const manifestPath = resolve(options.root, options.manifestFile);
  try {
    const report = parseMutationSummary(
      JSON.parse(readFileSync(inputPath, 'utf8')) as unknown,
      options.inputFile,
    );
    const manifest = parseMutationCoverageManifest(
      JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown,
    );
    const coverage = evaluateMutationCoverage(report, manifest, {
      min_mapped_rate: options.minMappedRate,
      min_killed_rate: options.minKilledRate,
    });
    return {
      ok: true,
      gate_ok: coverage.passed,
      input_path: inputPath,
      manifest_path: manifestPath,
      coverage,
    };
  } catch (error) {
    return {
      ok: false,
      gate_ok: false,
      input_path: inputPath,
      manifest_path: manifestPath,
      error: error instanceof Error ? error.message : 'invalid mutation coverage input',
    };
  }
}
