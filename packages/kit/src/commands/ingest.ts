import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FileArtifactStore } from '@aqa/artifacts';
import {
  type IngestReport,
  type PerformanceThresholdPolicy,
  type PerformanceThresholdResult,
  evaluatePerformanceThresholds,
  parseJunit,
  parseK6Summary,
  parseLocustSummary,
  parsePlaywrightTrace,
  parseSast,
} from '@aqa/ingest';

export interface IngestOptions {
  root: string;
  kind: 'junit' | 'sast' | 'semgrep' | 'k6' | 'locust' | 'playwright';
  file: string;
  tool?: string;
  threshold_file?: string;
}

export interface IngestResult {
  ok: boolean;
  error?: string;
  report?: IngestReport;
  artifact_path?: string;
  threshold_result?: PerformanceThresholdResult;
  threshold_artifact_path?: string;
}

export function runIngest(opts: IngestOptions): IngestResult {
  try {
    const input = readFileSync(opts.file);
    const report =
      opts.kind === 'junit'
        ? parseJunit(input.toString('utf8'), opts.file)
        : opts.kind === 'playwright'
          ? parsePlaywrightTrace(input, opts.file)
          : opts.kind === 'k6'
            ? parseK6Summary(JSON.parse(input.toString('utf8')) as unknown, opts.file)
            : opts.kind === 'locust'
              ? parseLocustSummary(JSON.parse(input.toString('utf8')) as unknown, opts.file)
              : parseSast(
                  JSON.parse(input.toString('utf8')) as unknown,
                  opts.file,
                  opts.tool ?? opts.kind,
                );
    if (opts.threshold_file && opts.kind !== 'k6' && opts.kind !== 'locust')
      throw new Error('threshold_file is supported only for k6 or locust ingestion');
    const store = new FileArtifactStore(join(opts.root, '.aqa', 'ingest'));
    const key = `${Date.now()}-${randomUUID()}.json`;
    store.putJsonSync(key, report);
    let thresholdResult: PerformanceThresholdResult | undefined;
    let thresholdArtifactPath: string | undefined;
    if (opts.threshold_file) {
      const policy = JSON.parse(
        readFileSync(opts.threshold_file, 'utf8'),
      ) as PerformanceThresholdPolicy;
      thresholdResult = evaluatePerformanceThresholds(report, policy);
      const thresholdKey = key.replace(/\.json$/, '.threshold.json');
      store.putJsonSync(thresholdKey, { policy, result: thresholdResult });
      thresholdArtifactPath = relative(opts.root, join(opts.root, '.aqa', 'ingest', thresholdKey));
    }
    return {
      ok: true,
      report,
      artifact_path: relative(opts.root, join(opts.root, '.aqa', 'ingest', key)),
      ...(thresholdResult ? { threshold_result: thresholdResult } : {}),
      ...(thresholdArtifactPath ? { threshold_artifact_path: thresholdArtifactPath } : {}),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
