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
const ALT_RUN_ID = '20260520-010000-runzzzzzz';
const STARTED_AT = '2026-05-20T00:00:00.000Z';
const FINISHED_AT = '2026-05-20T00:00:30.000Z';

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

function writeFindings(runDir: string, count: number): void {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const finding = {
      schema_version: '1',
      id: `AQA-2026-${String(i + 1).padStart(4, '0')}`,
      run_id: RUN_ID,
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

  it('defaults to the latest run when --run-id is omitted (lexical sort)', () => {
    const root = makeTempRoot();
    // Older run first; alt run lexically later so it should be chosen.
    const olderDir = makeRunDir(root, RUN_ID);
    writeEvents(olderDir, { runId: RUN_ID, profile: 'smoke', project: 'demo', findingsCount: 1 });
    writeFindings(olderDir, 1);
    const newerDir = makeRunDir(root, ALT_RUN_ID);
    writeEvents(newerDir, {
      runId: ALT_RUN_ID,
      profile: 'release-gate',
      project: 'demo',
      findingsCount: 3,
    });
    writeFindings(newerDir, 3);

    const result = runReport({ root });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.runId, ALT_RUN_ID);
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
