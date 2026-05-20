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

// LongSlug (per @aqa/schemas) cap. Reject anything that would let `runId`
// escape `.aqa/runs/` via traversal (`../..`, absolute paths, backslashes).
// The schema's own LongSlug also enforces ^[a-z0-9-]+$ — we mirror that
// here rather than import to keep the report command self-contained.
const RUN_ID_RE = /^[a-z0-9-]{1,80}$/;

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
  // Defense-in-depth: a `--run-id` of `../../../etc/passwd` (or similar)
  // would otherwise resolve outside `.aqa/runs/`. The schema treats run
  // IDs as LongSlug; mirror that constraint at the CLI boundary so a
  // typo or malicious input can't drive writes anywhere outside the
  // intended directory.
  if (!RUN_ID_RE.test(runIdResolved)) {
    return {
      ok: false,
      error: `report: invalid run id "${runIdResolved}" — must match ${RUN_ID_RE.source}`,
    };
  }
  const runDir = join(runsRoot, runIdResolved);
  if (!safeIsDir(runDir)) {
    return { ok: false, error: `report: run directory not found: ${runDir}` };
  }

  const eventsPath = join(runDir, 'events.jsonl');
  // Missing artifacts → fail-fast. A silent empty report on a corrupted
  // run dir hides the real problem (the run never wrote its audit trail).
  if (!existsSync(eventsPath)) {
    return {
      ok: false,
      error: `report: events.jsonl is missing at ${eventsPath} — run is incomplete or corrupted`,
    };
  }
  let events: ReadonlyArray<Record<string, unknown>>;
  try {
    events = readJsonl(eventsPath);
  } catch (e) {
    return {
      ok: false,
      error: `report: cannot read events.jsonl: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const findingsPath = join(runDir, 'findings.jsonl');
  if (!existsSync(findingsPath)) {
    return {
      ok: false,
      error: `report: findings.jsonl is missing at ${findingsPath} — run is incomplete or corrupted`,
    };
  }
  let findings: readonly Finding.Finding[];
  try {
    findings = readJsonl(findingsPath).map((raw, idx) => {
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
  // Writes can fail (read-only FS, disk full, permission). Return a
  // structured error rather than letting the exception escape into the
  // CLI's top-level unhandled-error path so callers get a clean message
  // plus an exit code derived from the structured result.
  try {
    if (format === 'md' || format === 'both') {
      const mdPath = join(runDir, 'report.md');
      writeFileSync(mdPath, renderMarkdown({ run, findings }), 'utf8');
      written.push(mdPath);
    }
    if (format === 'json' || format === 'both') {
      const jsonPath = join(runDir, 'report.json');
      writeFileSync(
        jsonPath,
        `${JSON.stringify(renderJson({ run, findings }), null, 2)}\n`,
        'utf8',
      );
      written.push(jsonPath);
    }
  } catch (e) {
    return {
      ok: false,
      error: `report: cannot write report file: ${e instanceof Error ? e.message : String(e)}`,
    };
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
  // Pick by file mtime, not lexical name. `aqa run --seed` produces
  // hash-based IDs (`run-<sha>`) that don't sort by recency. mtime is
  // monotonic enough for "the most recent run" semantics — lexical name
  // is only used as a deterministic tie-breaker (same-millisecond runs).
  const candidates: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of entries) {
    const dir = join(runsRoot, name);
    try {
      const st = statSync(dir);
      if (st.isDirectory()) {
        candidates.push({ name, mtimeMs: st.mtimeMs });
      }
    } catch {
      // ignore entries we can't stat (broken symlinks, races)
    }
  }
  candidates.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return b.name.localeCompare(a.name);
  });
  return candidates[0]?.name;
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  // Caller has already confirmed the file exists — this helper only
  // returns [] for an empty file (legitimate "zero events" case),
  // never for a missing one.
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

  const state: Run.Run['state'] = deriveState(finished, scenariosRun);

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

function deriveState(
  finished: Record<string, unknown> | undefined,
  scenariosRun: number,
): Run.Run['state'] {
  // `runRun` writes `run_finished` on success AND on most failure paths
  // (pack errors, scenario errors, missing scenarios, unsafe paths, runtime
  // errors, zero scenarios). Treat any non-zero error counter — or a run
  // that completed zero scenarios — as `failed` so the report doesn't
  // mislabel broken runs as successes.
  if (!finished) return 'running';
  const errorKeys = [
    'pack_errors',
    'scenario_errors',
    'missing_scenarios',
    'unsafe_paths',
    'runtime_errors',
  ] as const;
  for (const k of errorKeys) {
    const v = readPayloadNumber(finished, k);
    if (typeof v === 'number' && v > 0) return 'failed';
  }
  if (scenariosRun === 0) return 'failed';
  return 'succeeded';
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
