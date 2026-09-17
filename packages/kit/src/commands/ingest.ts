import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FileArtifactStore } from '@aqa/artifacts';
import {
  type IngestReport,
  parseJunit,
  parseK6Summary,
  parseLocustSummary,
  parseSast,
} from '@aqa/ingest';

export interface IngestOptions {
  root: string;
  kind: 'junit' | 'sast' | 'semgrep' | 'k6' | 'locust';
  file: string;
  tool?: string;
}

export interface IngestResult {
  ok: boolean;
  error?: string;
  report?: IngestReport;
  artifact_path?: string;
}

export function runIngest(opts: IngestOptions): IngestResult {
  try {
    const input = readFileSync(opts.file, 'utf8');
    const report =
      opts.kind === 'junit'
        ? parseJunit(input, opts.file)
        : opts.kind === 'k6'
          ? parseK6Summary(JSON.parse(input) as unknown, opts.file)
          : opts.kind === 'locust'
            ? parseLocustSummary(JSON.parse(input) as unknown, opts.file)
            : parseSast(JSON.parse(input) as unknown, opts.file, opts.tool ?? opts.kind);
    const store = new FileArtifactStore(join(opts.root, '.aqa', 'ingest'));
    const key = `${Date.now()}-${randomUUID()}.json`;
    store.putJsonSync(key, report);
    return {
      ok: true,
      report,
      artifact_path: relative(opts.root, join(opts.root, '.aqa', 'ingest', key)),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
