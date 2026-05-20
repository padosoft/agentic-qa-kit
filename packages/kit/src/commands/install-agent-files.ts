import { join } from 'node:path';
import { type AdapterTarget, renderForTargets } from '@aqa/adapters';
import { lastPathSegment, slugify } from '../cli-utils.js';
import { type WriteResult, writeFileSafe } from '../fs-utils.js';

const KNOWN_TARGETS: readonly AdapterTarget[] = ['claude', 'codex', 'gemini', 'copilot'];

export interface InstallAgentFilesOptions {
  root: string;
  /** Comma-separated string ("claude,codex") or already-split array. */
  targets: string | readonly string[];
  /** Optional override; if omitted, derived from the last segment of `root`. */
  projectName?: string;
  overwrite?: boolean;
  dryRun?: boolean;
}

export interface InstallAgentFilesOk {
  ok: true;
  targets: readonly AdapterTarget[];
  files: Array<{ path: string; target: AdapterTarget; result: WriteResult }>;
}

export interface InstallAgentFilesErr {
  ok: false;
  error: string;
}

export type InstallAgentFilesResult = InstallAgentFilesOk | InstallAgentFilesErr;

export function runInstallAgentFiles(opts: InstallAgentFilesOptions): InstallAgentFilesResult {
  const parsed = parseTargets(opts.targets);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const targets = parsed.targets;
  if (targets.length === 0) {
    return { ok: false, error: 'install-agent-files: --targets must list at least one target' };
  }

  const projectName = slugify(opts.projectName ?? lastPathSegment(opts.root));
  const rendered = renderForTargets(targets, { projectName, root: opts.root });

  const writeOpts = { overwrite: opts.overwrite, dryRun: opts.dryRun };
  const files: InstallAgentFilesOk['files'] = [];
  for (const target of targets) {
    for (const file of rendered.byTarget[target] ?? []) {
      const absPath = join(opts.root, file.path);
      const result = writeFileSafe(absPath, file.contents, writeOpts);
      files.push({ path: file.path, target, result });
    }
  }

  return { ok: true, targets, files };
}

interface ParsedTargets {
  ok: true;
  targets: readonly AdapterTarget[];
}
interface ParsedTargetsErr {
  ok: false;
  error: string;
}
function parseTargets(input: string | readonly string[]): ParsedTargets | ParsedTargetsErr {
  // Both code paths normalize the same way: split-if-string, then trim + drop
  // empties from each token. Without unified normalization, an array form
  // like `['claude ', '', 'codex']` would surface a confusing
  // "unknown target ' '" error even though the user clearly meant
  // `['claude', 'codex']`.
  const tokens: string[] = Array.isArray(input)
    ? input.map((s) => String(s))
    : String(input).split(',');
  const raw = tokens.map((s) => s.trim()).filter((s) => s.length > 0);
  // Preserve user-given order but de-dupe so the same target isn't written twice.
  const seen = new Set<string>();
  const targets: AdapterTarget[] = [];
  for (const t of raw) {
    const norm = t.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (!isKnownTarget(norm)) {
      return {
        ok: false,
        error: `install-agent-files: unknown target "${t}" — expected one of ${KNOWN_TARGETS.join(', ')}`,
      };
    }
    targets.push(norm);
  }
  return { ok: true, targets };
}

function isKnownTarget(s: string): s is AdapterTarget {
  return (KNOWN_TARGETS as readonly string[]).includes(s);
}
