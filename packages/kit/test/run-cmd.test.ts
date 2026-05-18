/**
 * v1.6 — End-to-end ecosystem smoke for `aqa run`.
 *
 * TDD discipline: this test was written *before* the `runRun` command existed.
 * It asserts the full chain — config load → pack discovery → scenario execution
 * → events.jsonl with valid hash chain → findings.jsonl produced — works from a
 * fresh fixture project without requiring a real network target.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runRun } from '../dist/commands/run.js';

/**
 * Re-walk the writer's hash chain. We can't use `@aqa/compliance.verifyEventChain`
 * directly because the two implementations differ slightly on canonical form and
 * on the seq=0 prev_hash (writer emits null, verifier expects "0…"). Reconciling
 * those formats is tracked as a v1.6 follow-up; this in-test verifier matches
 * `packages/runner/src/events.ts` exactly.
 */
function canonicalise(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as object)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
}

function verifyWriterChain(lines: string[]): { ok: boolean; reason?: string } {
  const ZERO = '0'.repeat(64);
  let prev = ZERO;
  for (let i = 0; i < lines.length; i++) {
    const ev = JSON.parse(lines[i] as string) as Record<string, unknown>;
    const { hash, prev_hash, ...rest } = ev as { hash: string; prev_hash: string | null };
    if (i === 0 && prev_hash !== null)
      return { ok: false, reason: `event[0] prev_hash must be null, got ${String(prev_hash)}` };
    if (i > 0 && prev_hash !== prev)
      return {
        ok: false,
        reason: `event[${i}] prev_hash ${String(prev_hash).slice(0, 12)}… does not chain`,
      };
    const recomputed = createHash('sha256')
      .update(prev + canonicalise(rest))
      .digest('hex');
    if (recomputed !== hash) return { ok: false, reason: `event[${i}] hash mismatch` };
    prev = hash;
  }
  return { ok: true };
}

function makeTempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'aqa-run-cmd-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

const MINIMAL_PROJECT_YAML = `schema_version: "1"
name: smoke-fixture
schema_compat: "1"
stack:
  runtime: node
  framework: hono
  sut_type: api
  test_runner: node
packs:
  - "./local-pack"
profiles:
  default: smoke
`;

const MINIMAL_PROFILES_YAML = `schema_version: "1"
profiles:
  smoke:
    name: smoke
    description: fast inner-loop subset
    targets: { sut_type: [api] }
    scope: { include_tags: [api] }
    budget: { max_findings: 50 }
    failure_policy: { on_fail: warn }
  release-gate:
    name: release-gate
    description: deterministic merge gate
    targets: { sut_type: [api] }
    scope: { include_tags: [api] }
    budget: { max_findings: 0 }
    failure_policy: { on_fail: block }
`;

const MINIMAL_RISK_MAP_YAML = `schema_version: "1"
risks:
  - id: r-smoke
    category: integrity
    description: smoke risk
    severity: high
    invariants: [inv-smoke]
`;

const MINIMAL_PACK_YAML = `schema_version: "1"
name: pack-local-smoke
version: 0.1.0
description: smoke-only fixture pack
author: test
license: MIT
applies_when:
  sut_type: [api]
templates: []
scenarios:
  - scenarios/smoke-noop.yaml
risks: []
oracles: []
probes: []
`;

const MINIMAL_PACK_PACKAGE_JSON = `{"name":"pack-local-smoke","version":"0.1.0","private":true}`;

const NOOP_SCENARIO_YAML = `schema_version: "1"
id: scn-smoke-noop
title: Smoke no-op scenario — proves the runner emits events without a network target
risk_refs: [r-smoke]
invariant_refs: [inv-smoke]
preconditions: []
steps:
  - id: probe-noop
    kind: http
    with: { method: "GET", url: "/healthz" }
oracles:
  - id: o-status-ok
    kind: http_status
    with: { expected: 200 }
tags: [api, smoke]
`;

function fixtureProject(): string {
  return makeTempProject({
    '.aqa/project.yaml': MINIMAL_PROJECT_YAML,
    '.aqa/profiles.yaml': MINIMAL_PROFILES_YAML,
    '.aqa/risk-map.yaml': MINIMAL_RISK_MAP_YAML,
    'local-pack/pack.yaml': MINIMAL_PACK_YAML,
    'local-pack/package.json': MINIMAL_PACK_PACKAGE_JSON,
    'local-pack/scenarios/smoke-noop.yaml': NOOP_SCENARIO_YAML,
  });
}

describe('aqa run', () => {
  it('boots from a fresh project, runs scenarios, and writes an audit + findings to .aqa/runs/<run_id>/', async () => {
    const root = fixtureProject();
    const result = await runRun({ root, profile: 'smoke' });

    assert.equal(result.ok, true, `run must succeed, got: ${JSON.stringify(result)}`);
    assert.ok(result.runId, 'runId must be set');
    assert.ok(result.runDir, 'runDir must be set');

    const eventsPath = join(result.runDir, 'events.jsonl');
    const findingsPath = join(result.runDir, 'findings.jsonl');
    assert.ok(existsSync(eventsPath), `events.jsonl must exist at ${eventsPath}`);
    assert.ok(existsSync(findingsPath), `findings.jsonl must exist at ${findingsPath}`);

    const eventLines = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(
      eventLines.length >= 3,
      `expected ≥3 events (run_started, probe, oracle, run_completed), got ${eventLines.length}`,
    );

    const chain = verifyWriterChain(eventLines);
    assert.equal(chain.ok, true, `audit chain must verify, got: ${chain.reason ?? ''}`);
  });

  it('rejects an unknown profile rather than silently running all scenarios', async () => {
    const root = fixtureProject();
    const result = await runRun({ root, profile: 'no-such-profile' });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /profile/i);
  });

  it('produces a deterministic run_id when seed is provided', async () => {
    const root = fixtureProject();
    const a = await runRun({ root, profile: 'smoke', seed: 'fixed-seed' });
    const b = await runRun({ root, profile: 'smoke', seed: 'fixed-seed' });
    assert.equal(a.runId, b.runId, 'identical seeds must produce identical run_ids');
  });
});

describe('aqa run — fs layout', () => {
  it('creates a separate run directory per invocation', async () => {
    const root = fixtureProject();
    await runRun({ root, profile: 'smoke' });
    await new Promise((r) => setTimeout(r, 10));
    await runRun({ root, profile: 'smoke' });
    const runsDir = join(root, '.aqa', 'runs');
    const entries = readdirSync(runsDir);
    assert.ok(entries.length >= 2, `expected ≥2 run directories, found ${entries.length}`);
  });
});
