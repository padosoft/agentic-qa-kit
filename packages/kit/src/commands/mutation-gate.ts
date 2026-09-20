import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type MutationCoverageResult,
  type MutationRegressionCoverageResult,
  type MutationReport,
  type MutationThresholdResult,
  evaluateMutationCoverage,
  evaluateMutationHoldoutRegressionEvidence,
  evaluateMutationRegressionEvidence,
  evaluateMutationThreshold,
  parseMutationCoverageManifest,
  parseMutationHoldoutSplit,
  parseMutationRegressionEvidence,
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

export interface MutationRegressionGateOptions {
  root: string;
  inputFile: string;
  manifestFile: string;
  evidenceFile: string;
  minKillRate: number;
  expectedSourceRevision?: string;
  holdoutSplitFile?: string;
}

export interface MutationRegressionGateResult {
  ok: boolean;
  gate_ok: boolean;
  input_path: string;
  manifest_path: string;
  evidence_path: string;
  regression?: MutationRegressionCoverageResult;
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

/** Gate an external mutation report against observed regression executions. */
export function runMutationRegressionGate(
  options: MutationRegressionGateOptions,
): MutationRegressionGateResult {
  const inputPath = resolve(options.root, options.inputFile);
  const manifestPath = resolve(options.root, options.manifestFile);
  const evidencePath = resolve(options.root, options.evidenceFile);
  const holdoutSplitPath = options.holdoutSplitFile
    ? resolve(options.root, options.holdoutSplitFile)
    : undefined;
  try {
    const report = parseMutationSummary(
      JSON.parse(readFileSync(inputPath, 'utf8')) as unknown,
      options.inputFile,
    );
    const manifest = parseMutationCoverageManifest(
      JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown,
    );
    const evidence = parseMutationRegressionEvidence(
      JSON.parse(readFileSync(evidencePath, 'utf8')) as unknown,
    );
    if (
      options.expectedSourceRevision !== undefined &&
      evidence.source_revision !== options.expectedSourceRevision
    ) {
      throw new Error('mutation regression source revision does not match the expected revision');
    }
    const holdoutSplit =
      evidence.plan_digest !== undefined && holdoutSplitPath !== undefined
        ? parseMutationHoldoutSplit(JSON.parse(readFileSync(holdoutSplitPath, 'utf8')) as unknown)
        : undefined;
    if (holdoutSplit !== undefined) {
      const supplied = new Map(
        manifest.links.map((link) => [link.mutation_id, JSON.stringify(link)]),
      );
      const planned = [...holdoutSplit.train.links, ...holdoutSplit.holdout.links];
      const plannedIds = new Set(planned.map((link) => link.mutation_id));
      if (plannedIds.size !== planned.length || planned.length !== supplied.size)
        throw new Error(
          'mutation holdout split is not an exact partition of the supplied manifest',
        );
      for (const link of planned) {
        if (supplied.get(link.mutation_id) !== JSON.stringify(link))
          throw new Error(
            'mutation holdout split is not an exact partition of the supplied manifest',
          );
      }
    }
    const requiredHoldoutSplit = () => {
      if (holdoutSplit === undefined)
        throw new Error('plan-bound mutation evidence requires --holdout-split');
      return holdoutSplit;
    };
    const regression =
      evidence.plan_digest !== undefined
        ? holdoutSplitPath === undefined
          ? (() => {
              throw new Error('plan-bound mutation evidence requires --holdout-split');
            })()
          : evaluateMutationHoldoutRegressionEvidence(
              report,
              requiredHoldoutSplit(),
              evidence,
              options.minKillRate,
            )
        : evaluateMutationRegressionEvidence(report, manifest, evidence, options.minKillRate);
    return {
      ok: true,
      gate_ok: regression.passed,
      input_path: inputPath,
      manifest_path: manifestPath,
      evidence_path: evidencePath,
      regression,
    };
  } catch (error) {
    return {
      ok: false,
      gate_ok: false,
      input_path: inputPath,
      manifest_path: manifestPath,
      evidence_path: evidencePath,
      error: error instanceof Error ? error.message : 'invalid mutation regression evidence',
    };
  }
}
