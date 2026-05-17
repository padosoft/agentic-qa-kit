import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface WriteOptions {
  /** When true, overwrite existing file. When false (default), skip and report 'skipped'. */
  overwrite?: boolean | undefined;
  /** When true, don't write to disk; just report what would happen. */
  dryRun?: boolean | undefined;
}

export type WriteResult = 'created' | 'overwritten' | 'skipped-exists' | 'dry-run';

export function writeFileSafe(path: string, content: string, opts: WriteOptions = {}): WriteResult {
  const exists = existsSync(path);
  if (exists && !opts.overwrite) return 'skipped-exists';
  if (opts.dryRun) return 'dry-run';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return exists ? 'overwritten' : 'created';
}
