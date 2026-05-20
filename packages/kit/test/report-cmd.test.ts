/**
 * v1.9 — `aqa report` CLI verb.
 *
 * Renders the on-disk run artifacts into report.md + report.json. These
 * tests build a synthetic run directory (events.jsonl + findings.jsonl)
 * because runRun is async, network-touched in some configurations, and
 * over-coupled for a focused reporter test. The synthetic dir matches the
 * canonical schema shapes from @aqa/schemas Run/Finding.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runReport } from '../dist/commands/report.js';

const RUN_ID = '20260520-000000-runabcdef';
const STARTED_AT = '2026-05-20T00:00:00.000Z';
const FINISHED_AT = '2026-05-20T00:00:30.000Z';

// Slight sleep used to put a real mtime delta between consecutive run dirs
// in the "latest run" test. Some filesystems otherwise group rapid mkdirs
// under the same mtimeMs and force the tie-breaker into action.
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'aqa-report-'));
}

function makeRunDir(root: string, runId: string): string {
  const dir = join(root, '.aqa', 'runs', runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Build minimal valid hash-chained events.jsonl. */
function writeEvents(
  runDir: string,
  opts: { runId: string; profile: string; project: string; findingsCount: number },
): void {
  const events: Array<Record<string, unknown>> = [];
  let prev: string | null = null;
  function append(partial: Omit<Record<string, unknown>, 'seq' | 'prev_hash' | 'hash'>): void {
    const seq = events.length;
    // Hash recomputation here is a stub — the writer's exact canonicalization
    // is exercised in @aqa/runner / @aqa/compliance tests. `aqa report`
    // doesn't validate the chain (it just parses fields), so any
    // deterministic stub hash keeps schema.parse happy.
    const body = JSON.stringify({ ...partial, seq });
    const hash = sha256Hex((prev ?? '') + body);
    const evt = { schema_version: '1', seq, prev_hash: prev, hash, ...partial };
    events.push(evt);
    prev = hash;
  }
  append({
    ts: STARTED_AT,
    run_id: opts.runId,
    kind: 'run_started',
    actor: { type: 'orchestrator', id: 'aqa-cli' },
    payload: { profile: opts.profile, project: opts.project },
  });
  append({
    ts: FINISHED_AT,
    run_id: opts.runId,
    kind: 'run_finished',
    actor: { type: 'orchestrator', id: 'aqa-cli' },
    payload: {
      scenarios_run: 2,
      findings: opts.findingsCount,
      pack_errors: 0,
      scenario_errors: 0,
      missing_scenarios: 0,
      unsafe_paths: 0,
      runtime_errors: 0,
    },
  });
  writeFileSync(
    join(runDir, 'events.jsonl'),
    `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'utf8',
  );
}

function writeFindings(runDir: string, count: number, runId: string = RUN_ID): void {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const finding = {
      schema_version: '1',
      id: `AQA-2026-${String(i + 1).padStart(4, '0')}`,
      run_id: runId,
      risk_id: 'r-example',
      scenario_id: 'scn-example-demo',
      title: `Synthetic finding ${i + 1}`,
      severity: i === 0 ? 'critical' : 'low',
      status: 'draft',
      summary: 'reporter smoke test',
      evidence: [],
      execution_mode: 'orchestrator',
      verification_floor: 'scenario_level',
      confidence: 0.5,
      discovered_at: STARTED_AT,
    };
    lines.push(JSON.stringify(finding));
  }
  writeFileSync(
    join(runDir, 'findings.jsonl'),
    `${lines.join('\n')}${lines.length ? '\n' : ''}`,
    'utf8',
  );
}

describe('aqa report — happy path', () => {
  it('renders both report.md and report.json for the explicit run-id', () => {
    const root = makeTempRoot();
    const runDir = makeRunDir(root, RUN_ID);
    writeEvents(runDir, { runId: RUN_ID, profile: 'smoke', project: 'demo', findingsCount: 2 });
    writeFindings(runDir, 2);

    const result = runReport({ root, runId: RUN_ID });
    assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
    if (!result.ok) return;

    assert.equal(result.runId, RUN_ID);
    assert.equal(result.findingsCount, 2);
    assert.ok(existsSync(join(runDir, 'report.md')), 'report.md must exist');
    assert.ok(existsSync(join(runDir, 'report.json')), 'report.json must exist');

    const md = readFileSync(join(runDir, 'report.md'), 'utf8');
    assert.match(md, /# AQA report/);
    assert.match(md, /demo/);
    assert.match(md, /AQA-2026-0001/);
    assert.match(md, /Synthetic finding 1/);

    const json = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')) as {
      schema_version: string;
      run: { id: string; project: string; profile: string; state: string };
      findings: Array<{ id: string }>;
      summary: { total: number; severities: Record<string, number> };
    };
    assert.equal(json.schema_version, '1');
    assert.equal(json.run.id, RUN_ID);
    assert.equal(json.run.project, 'demo');
    assert.equal(json.run.profile, 'smoke');
    assert.equal(json.run.state, 'succeeded');
    assert.equal(json.findings.length, 2);
    assert.equal(json.summary.total, 2);
    assert.equal(json.summary.severities.critical, 1);
    assert.equal(json.summary.severities.low, 1);
  });

  it('defaults to the latest run by file mtime, not lexical name (Copilot iter 1 P2)', async () => {
    // Critical correctness: `aqa run --seed` produces hash-based IDs
    // (run-<sha>) that do NOT sort by recency. Picking by mtime keeps
    // "latest" honest in mixed-naming directories. Here we intentionally
    // create the lexically-EARLIER name LAST so a name-based sort would
    // pick the wrong dir.
    const root = makeTempRoot();
    const earlierName = 'run-aaaa-but-newer'; // lexically earlier
    const olderName = 'run-zzzz-but-older'; // lexically later
    const olderDir = makeRunDir(root, olderName);
    writeEvents(olderDir, {
      runId: olderName,
      profile: 'smoke',
      project: 'demo',
      findingsCount: 1,
    });
    writeFindings(olderDir, 1, olderName);
    await sleep(20);
    const newerDir = makeRunDir(root, earlierName);
    writeEvents(newerDir, {
      runId: earlierName,
      profile: 'release-gate',
      project: 'demo',
      findingsCount: 3,
    });
    writeFindings(newerDir, 3, earlierName);

    const result = runReport({ root });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // mtime-newer dir wins even though its name sorts EARLIER lexically.
    assert.equal(result.runId, earlierName);
    assert.equal(result.findingsCount, 3);
  });

  it('emits only report.md when format=md', () => {
    const root = makeTempRoot();
    const runDir = makeRunDir(root, RUN_ID);
    writeEvents(runDir, { runId: RUN_ID, profile: 'smoke', project: 'demo', findingsCount: 0 });
    writeFindings(runDir, 0);

    const result = runReport({ root, runId: RUN_ID, format: 'md' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(existsSync(join(runDir, 'report.md')));
    assert.ok(!existsSync(join(runDir, 'report.json')), 'report.json must not exist for format=md');
    assert.equal(result.files.length, 1);
  });

  it('emits only report.json when format=json', () => {
    const root = makeTempRoot();
    const runDir = makeRunDir(root, RUN_ID);
    writeEvents(runDir, { runId: RUN_ID, profile: 'smoke', project: 'demo', findingsCount: 0 });
    writeFindings(runDir, 0);

    const result = runReport({ root, runId: RUN_ID, format: 'json' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(!existsSync(join(runDir, 'report.md')));
    assert.ok(existsSync(join(runDir, 'report.json')));
  });

  it('handles zero findings without crashing', () => {
    const root = makeTempRoot();
    const runDir = makeRunDir(root, RUN_ID);
    writeEvents(runDir, { runId: RUN_ID, profile: 'smoke', project: 'demo', findingsCount: 0 });
    writeFindings(runDir, 0);

    const result = runReport({ root, runId: RUN_ID });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.findingsCount, 0);
    const md = readFileSync(join(runDir, 'report.md'), 'utf8');
    assert.match(md, /No findings/);
  });
});

describe('aqa report — error cases', () => {
  it('returns error when .aqa/runs does not exist', () => {
    const root = makeTempRoot();
    const result = runReport({ root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /no runs directory/);
  });

  it('returns error when --run-id points to a missing dir', () => {
    const root = makeTempRoot();
    makeRunDir(root, RUN_ID);
    const result = runReport({ root, runId: 'does-not-exist' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /run directory not found/);
  });

  it('returns error when .aqa/runs exists but is empty', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.aqa', 'runs'), { recursive: true });
    const result = runReport({ root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /no runs found/);
  });

  it('returns error on malformed JSONL line in events.jsonl', () => {
    const root = makeTempRoot();
    const runDir = makeRunDir(root, RUN_ID);
    writeFileSync(join(runDir, 'events.jsonl'), '{not json\n', 'utf8');
    writeFileSync(join(runDir, 'findings.jsonl'), '', 'utf8');
    const result = runReport({ root, runId: RUN_ID });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /cannot read events\.jsonl/);
  });

  it('returns error when events.jsonl is missing (Copilot iter 1 P1)', () => {
    const root = makeTempRoot();
    const runDir = makeRunDir(root, RUN_ID);
    // findings.jsonl present, events.jsonl missing
    writeFileSync(join(runDir, 'findings.jsonl'), '', 'utf8');
    const result = runReport({ root, runId: RUN_ID });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /events\.jsonl is missing/);
  });

  it('returns error when findings.jsonl is missing (Copilot iter 1 P1)', () => {
    const root = makeTempRoot();
    const runDir = makeRunDir(root, RUN_ID);
    writeEvents(runDir, { runId: RUN_ID, profile: 'smoke', project: 'demo', findingsCount: 0 });
    // findings.jsonl intentionally not created
    const result = runReport({ root, runId: RUN_ID });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /findings\.jsonl is missing/);
  });

  it('rejects a --run-id that would escape .aqa/runs via traversal (Copilot iter 1)', () => {
    const root = makeTempRoot();
    // .aqa/runs has to exist or we hit the prior guard first
    mkdirSync(join(root, '.aqa', 'runs'), { recursive: true });
    const result = runReport({ root, runId: '../../etc/passwd' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /invalid run id/);
  });

  it('rejects a --run-id containing characters outside [a-z0-9-]', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.aqa', 'runs'), { recursive: true });
    const result = runReport({ root, runId: 'NOT_A_SLUG' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /invalid run id/);
  });
});

describe('aqa report — state reconstruction (Copilot iter 1 P1)', () => {
  it('marks state=failed when run_finished payload has pack_errors > 0', () => {
    const root = makeTempRoot();
    const runDir = makeRunDir(root, RUN_ID);
    // Custom events with non-zero pack_errors
    const events = [
      {
        schema_version: '1',
        seq: 0,
        prev_hash: null,
        hash: '0'.repeat(64),
        ts: STARTED_AT,
        run_id: RUN_ID,
        kind: 'run_started',
        actor: { type: 'orchestrator', id: 'aqa-cli' },
        payload: { profile: 'smoke', project: 'demo' },
      },
      {
        schema_version: '1',
        seq: 1,
        prev_hash: '0'.repeat(64),
        hash: '1'.repeat(64),
        ts: FINISHED_AT,
        run_id: RUN_ID,
        kind: 'run_finished',
        actor: { type: 'orchestrator', id: 'aqa-cli' },
        payload: {
          scenarios_run: 0,
          findings: 0,
          pack_errors: 1,
          scenario_errors: 0,
          missing_scenarios: 0,
          unsafe_paths: 0,
          runtime_errors: 0,
        },
      },
    ];
    writeFileSync(
      join(runDir, 'events.jsonl'),
      `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
      'utf8',
    );
    writeFindings(runDir, 0);
    const result = runReport({ root, runId: RUN_ID });
    assert.equal(result.ok, true);
    const json = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')) as {
      run: { state: string };
    };
    assert.equal(json.run.state, 'failed');
  });

  it('marks state=failed when scenarios_run is 0 even with no error counters', () => {
    const root = makeTempRoot();
    const runDir = makeRunDir(root, RUN_ID);
    writeEvents(runDir, { runId: RUN_ID, profile: 'smoke', project: 'demo', findingsCount: 0 });
    // writeEvents above sets scenarios_run: 2 — override with a custom file
    const events = [
      {
        schema_version: '1',
        seq: 0,
        prev_hash: null,
        hash: '0'.repeat(64),
        ts: STARTED_AT,
        run_id: RUN_ID,
        kind: 'run_started',
        actor: { type: 'orchestrator', id: 'aqa-cli' },
        payload: { profile: 'smoke', project: 'demo' },
      },
      {
        schema_version: '1',
        seq: 1,
        prev_hash: '0'.repeat(64),
        hash: '1'.repeat(64),
        ts: FINISHED_AT,
        run_id: RUN_ID,
        kind: 'run_finished',
        actor: { type: 'orchestrator', id: 'aqa-cli' },
        payload: {
          scenarios_run: 0,
          findings: 0,
          pack_errors: 0,
          scenario_errors: 0,
          missing_scenarios: 0,
          unsafe_paths: 0,
          runtime_errors: 0,
        },
      },
    ];
    writeFileSync(
      join(runDir, 'events.jsonl'),
      `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
      'utf8',
    );
    writeFindings(runDir, 0);
    const result = runReport({ root, runId: RUN_ID });
    assert.equal(result.ok, true);
    const json = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')) as {
      run: { state: string };
    };
    assert.equal(json.run.state, 'failed');
  });

  it('marks state=running when no run_finished event is present', () => {
    const root = makeTempRoot();
    const runDir = makeRunDir(root, RUN_ID);
    const events = [
      {
        schema_version: '1',
        seq: 0,
        prev_hash: null,
        hash: '0'.repeat(64),
        ts: STARTED_AT,
        run_id: RUN_ID,
        kind: 'run_started',
        actor: { type: 'orchestrator', id: 'aqa-cli' },
        payload: { profile: 'smoke', project: 'demo' },
      },
    ];
    writeFileSync(
      join(runDir, 'events.jsonl'),
      `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
      'utf8',
    );
    writeFindings(runDir, 0);
    const result = runReport({ root, runId: RUN_ID });
    assert.equal(result.ok, true);
    const json = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')) as {
      run: { state: string; finished_at?: string };
    };
    assert.equal(json.run.state, 'running');
    assert.equal(json.run.finished_at, undefined);
  });

  it('returns error on schema-invalid finding', () => {
    const root = makeTempRoot();
    const runDir = makeRunDir(root, RUN_ID);
    writeEvents(runDir, { runId: RUN_ID, profile: 'smoke', project: 'demo', findingsCount: 1 });
    writeFileSync(join(runDir, 'findings.jsonl'), `${JSON.stringify({ id: 'broken' })}\n`, 'utf8');
    const result = runReport({ root, runId: RUN_ID });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /cannot read findings\.jsonl/);
  });
});
