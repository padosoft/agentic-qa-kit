/**
 * `aqa report` — renders the on-disk run artifacts (`events.jsonl` +
 * `findings.jsonl`) into a Markdown summary and a stable JSON view for
 * downstream dashboards.
 *
 * Loose contract (intentional, see also `runRun`):
 *  - `aqa run` writes events + findings, NOT a `run.json` (the canonical
 *    Run shape is reconstructed from the audit chain). `aqa report` does
 *    that reconstruction here from the first `run_started` and last
 *    `run_finished` events so reports remain replayable from the audit
 *    trail alone, without coupling reporter output to a new sidecar file.
 *  - Reports are written into the same run directory so a junior can hand
 *    a single `runDir` to a teammate and get the whole story (events,
 *    findings, replay artifacts, plus the rendered report).
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderJson, renderMarkdown } from '@aqa/reporter';
import { Finding, type Run } from '@aqa/schemas';

export type ReportFormat = 'md' | 'json' | 'both';

export interface ReportOptions {
  root: string;
  /** Run id (== directory name under `.aqa/runs/`). Omit to use the latest run. */
  runId?: string;
  /** Default 'both'. Controls which artifacts are written. */
  format?: ReportFormat;
}

export interface ReportOk {
  ok: true;
  runId: string;
  runDir: string;
  files: string[];
  findingsCount: number;
}

export interface ReportErr {
  ok: false;
  error: string;
}

export type ReportResult = ReportOk | ReportErr;

export function runReport(opts: ReportOptions): ReportResult {
  const format: ReportFormat = opts.format ?? 'both';
  if (format !== 'md' && format !== 'json' && format !== 'both') {
    return {
      ok: false,
      error: `report: --format must be md | json | both, got "${String(format)}"`,
    };
  }
  const runsRoot = join(opts.root, '.aqa', 'runs');
  if (!existsSync(runsRoot)) {
    return {
      ok: false,
      error: `report: no runs directory at ${runsRoot} — run \`aqa run --profile smoke\` first`,
    };
  }
  const runIdResolved = opts.runId ?? latestRunId(runsRoot);
  if (!runIdResolved) {
    return {
      ok: false,
      error: `report: no runs found under ${runsRoot} — run \`aqa run --profile smoke\` first`,
    };
  }
  const runDir = join(runsRoot, runIdResolved);
  if (!safeIsDir(runDir)) {
    return { ok: false, error: `report: run directory not found: ${runDir}` };
  }

  let events: ReadonlyArray<Record<string, unknown>>;
  try {
    events = readJsonl(join(runDir, 'events.jsonl'));
  } catch (e) {
    return {
      ok: false,
      error: `report: cannot read events.jsonl: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let findings: readonly Finding.Finding[];
  try {
    findings = readJsonl(join(runDir, 'findings.jsonl')).map((raw, idx) => {
      const parsed = Finding.Finding.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`findings.jsonl line ${idx + 1}: ${parsed.error.message}`);
      }
      return parsed.data;
    });
  } catch (e) {
    return {
      ok: false,
      error: `report: cannot read findings.jsonl: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const run = reconstructRun({
    runId: runIdResolved,
    runDir,
    events,
    findingsCount: findings.length,
  });

  const written: string[] = [];
  if (format === 'md' || format === 'both') {
    const mdPath = join(runDir, 'report.md');
    writeFileSync(mdPath, renderMarkdown({ run, findings }), 'utf8');
    written.push(mdPath);
  }
  if (format === 'json' || format === 'both') {
    const jsonPath = join(runDir, 'report.json');
    writeFileSync(jsonPath, `${JSON.stringify(renderJson({ run, findings }), null, 2)}\n`, 'utf8');
    written.push(jsonPath);
  }

  return {
    ok: true,
    runId: runIdResolved,
    runDir,
    files: written,
    findingsCount: findings.length,
  };
}

function latestRunId(runsRoot: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(runsRoot);
  } catch {
    return undefined;
  }
  const dirs = entries
    .filter((name) => safeIsDir(join(runsRoot, name)))
    // Run IDs include an ISO-like prefix; lexical sort orders by recency.
    .sort();
  return dirs.at(-1);
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const out: Array<Record<string, unknown>> = [];
  let lineNo = 0;
  for (const raw of text.split('\n')) {
    lineNo += 1;
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as unknown;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        out.push(obj as Record<string, unknown>);
      }
    } catch (e) {
      throw new Error(`${path} line ${lineNo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

interface ReconstructInput {
  runId: string;
  runDir: string;
  events: ReadonlyArray<Record<string, unknown>>;
  findingsCount: number;
}

function reconstructRun(input: ReconstructInput): Run.Run {
  // Best-effort reconstruction from the audit chain — see file header. The
  // reporter only reads a small subset of Run fields, but we still build the
  // full schema-conformant object so the JSON report stays valid for the
  // admin UI and any external dashboard.
  const { runId, runDir, events, findingsCount } = input;
  const started = pickEvent(events, 'run_started');
  const finished = pickEvent(events, 'run_finished');

  const startedAt = readString(started, 'ts') ?? new Date(0).toISOString();
  const finishedAt = readString(finished, 'ts');
  const profile = readPayloadString(started, 'profile') ?? 'unknown';
  const project = readPayloadString(started, 'project') ?? 'unknown';
  const scenariosRun = readPayloadNumber(finished, 'scenarios_run') ?? 0;
  const totalsFindings = readPayloadNumber(finished, 'findings') ?? findingsCount;

  const state: Run.Run['state'] = finished ? 'succeeded' : 'running';

  const run: Run.Run = {
    schema_version: '1',
    id: runId,
    started_at: startedAt,
    ...(finishedAt ? { finished_at: finishedAt } : {}),
    state,
    project,
    profile,
    execution_mode: 'orchestrator',
    config_snapshot: {
      profile,
      execution_mode: 'orchestrator',
      packs: [],
      // Deterministic dummy: this report path doesn't recompute the config
      // hash from disk. The admin UI keys on `run.id`, not `config_hash`.
      config_hash: '0'.repeat(64),
    },
    totals: {
      scenarios: scenariosRun,
      findings: totalsFindings,
      probes: 0,
      llm_tokens_in: 0,
      llm_tokens_out: 0,
      llm_cost_usd: 0,
    },
    artifact_dir: runDir,
  };
  return run;
}

function pickEvent(
  events: ReadonlyArray<Record<string, unknown>>,
  kind: string,
): Record<string, unknown> | undefined {
  // run_started: first match; run_finished: last (a re-run within the same
  // dir would have appended a new finalization line). Both kinds appear at
  // most once today, but the lookup stays defensive.
  if (kind === 'run_finished') {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.kind === kind) return events[i];
    }
    return undefined;
  }
  for (const e of events) {
    if (e.kind === kind) return e;
  }
  return undefined;
}

function readString(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = obj?.[key];
  return typeof v === 'string' ? v : undefined;
}

function readPayloadString(
  obj: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const payload = obj?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

function readPayloadNumber(
  obj: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const payload = obj?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
