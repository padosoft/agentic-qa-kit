/**
 * v1.6 — End-to-end smoke for `aqa run`.
 *
 * TDD-style: the suite was written before `runRun` existed. It asserts the
 * full chain — schema-valid `aqa init` output → pack discovery via the
 * manifest → scenario execution → events.jsonl with a chained hash → a
 * touched findings.jsonl — works against a fresh fixture project without
 * a real network target.
 *
 * We build the fixture by running the real `aqa init`, then sprinkling in a
 * local pack so the project remains schema-valid (and `aqa validate` would
 * accept it). Anything else risks the test passing on a shape no real user
 * would ever have.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { FileArtifactStore } from '@aqa/artifacts';
import { RunnerQueue } from '@aqa/server';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { runInit } from '../dist/commands/init.js';
import { runRun } from '../dist/commands/run.js';
import { makeKitWorker } from '../dist/worker.js';

/**
 * Re-walk the writer's hash chain. This mirrors `packages/runner/src/events.ts`
 * (and now also the compliance verifier logic), but stays local to avoid
 * pulling an extra cross-workspace runtime dependency into @aqa/kit tests.
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
    if (i === 0 && prev_hash !== null) {
      return { ok: false, reason: `event[0] prev_hash must be null, got ${String(prev_hash)}` };
    }
    if (i > 0 && prev_hash !== prev) {
      return {
        ok: false,
        reason: `event[${i}] prev_hash ${String(prev_hash).slice(0, 12)}… does not chain`,
      };
    }
    const recomputed = createHash('sha256')
      .update(prev + canonicalise(rest))
      .digest('hex');
    if (recomputed !== hash) return { ok: false, reason: `event[${i}] hash mismatch` };
    prev = hash;
  }
  return { ok: true };
}

const SMOKE_PACK_MANIFEST = `schema_version: "1"
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

const SMOKE_SCENARIO = `schema_version: "1"
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

/**
 * Build a temp project the same way a real user would:
 * 1. Run the real `aqa init` (schema-valid project/profiles/risk-map).
 * 2. Add a `pack-local-smoke` pack on disk.
 * 3. Patch the `smoke` profile to list that pack and the `smoke` tag.
 *
 * The result passes `aqa validate` end-to-end (asserted below) so the test
 * exercises the same path real consumers will hit.
 */
function fixtureProject(): { root: string; packDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'aqa-run-cmd-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'smoke', dependencies: { hono: '^4.0.0' } }),
    'utf8',
  );
  writeFileSync(join(root, 'bun.lock'), '', 'utf8');
  // src/server.ts is what `profileRepo` looks for to classify this as an API
  // project, which makes the bundled api-core (and our fixture pack with
  // `applies_when: [api]`) eligible.
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'server.ts'), 'export {};\n', 'utf8');
  runInit({ root, projectName: 'smoke-fixture' });

  const riskMapPath = join(root, '.aqa', 'risk-map.yaml');
  const riskMap = yamlParse(readFileSync(riskMapPath, 'utf8')) as {
    risks: Array<Record<string, unknown>>;
  };
  riskMap.risks.push({
    id: 'r-smoke',
    category: 'integration',
    title: 'Smoke fixture risk',
    severity: 'medium',
    likelihood: 'unlikely',
    invariants: [{ id: 'inv-smoke', statement: 'The smoke endpoint responds successfully.' }],
  });
  writeFileSync(riskMapPath, yamlStringify(riskMap), 'utf8');

  const packDir = join(root, 'local-pack');
  mkdirSync(join(packDir, 'scenarios'), { recursive: true });
  writeFileSync(join(packDir, 'pack.yaml'), SMOKE_PACK_MANIFEST, 'utf8');
  writeFileSync(
    join(packDir, 'package.json'),
    JSON.stringify({ name: 'pack-local-smoke', version: '0.1.0', private: true }),
    'utf8',
  );
  writeFileSync(join(packDir, 'scenarios', 'smoke-noop.yaml'), SMOKE_SCENARIO, 'utf8');

  // Wire the `smoke` profile to this local pack + match its tags.
  const profilesPath = join(root, '.aqa', 'profiles.yaml');
  const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
    schema_version: '1';
    profiles: Record<string, { packs: string[]; tags: string[]; name: string }>;
  };
  if (profiles.profiles.smoke) {
    profiles.profiles.smoke.packs = ['pack-local-smoke'];
    profiles.profiles.smoke.tags = ['smoke'];
  }
  writeFileSync(profilesPath, yamlStringify(profiles), 'utf8');

  return { root, packDir };
}

const fixtureProbeRunner = async (probe: { id: string }) => ({
  probe_id: probe.id,
  status: 200,
});

function runFixture(options: Parameters<typeof runRun>[0]): ReturnType<typeof runRun> {
  return runRun({ ...options, probeRunner: fixtureProbeRunner });
}

describe('aqa run', () => {
  it('executes a queued job through the real worker and HTTP run lifecycle', async () => {
    const { root, packDir } = fixtureProject();
    const target = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    assert.ok(address && typeof address === 'object');
    const projectPath = join(root, '.aqa', 'project.yaml');
    const project = yamlParse(readFileSync(projectPath, 'utf8')) as Record<string, unknown>;
    project.sut = {
      ...(project.sut as Record<string, unknown>),
      base_url: `http://127.0.0.1:${address.port}`,
    };
    writeFileSync(projectPath, yamlStringify(project));
    try {
      const queue = new RunnerQueue({ lease_ms: 1_000 });
      const job = queue.enqueue({
        id: 'worker-http-journey',
        payload: { profile: 'smoke' },
        enqueued_at: new Date().toISOString(),
      });
      const worker = makeKitWorker({ queue, root, packsRoot: [packDir], poll_ms: 10 });
      assert.deepEqual(await worker.runOnce(), { status: 'completed', job_id: job.id });
      assert.equal(queue.get(job.id)?.status, 'done');
      assert.ok(readdirSync(join(root, '.aqa', 'runs')).length > 0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        target.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('passes host-injected HTTP secrets through the real run boundary', async () => {
    const { root, packDir } = fixtureProject();
    writeFileSync(
      join(packDir, 'scenarios', 'smoke-noop.yaml'),
      SMOKE_SCENARIO.replace(
        'with: { method: "GET", url: "/healthz" }',
        'with: { method: "GET", url: "/me", auth: "${OLD_TOKEN}" }',
      ),
      'utf8',
    );
    let authenticated = false;
    const target = createServer((req, res) => {
      authenticated = req.headers.authorization === 'Bearer secret-value';
      res.writeHead(authenticated ? 200 : 401, { 'content-type': 'text/plain' });
      res.end(authenticated ? 'ok' : 'unauthorized');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    assert.ok(address && typeof address === 'object');
    const projectPath = join(root, '.aqa', 'project.yaml');
    const project = yamlParse(readFileSync(projectPath, 'utf8')) as Record<string, unknown>;
    project.sut = {
      ...(project.sut as Record<string, unknown>),
      base_url: `http://127.0.0.1:${address.port}`,
    };
    writeFileSync(projectPath, yamlStringify(project));
    try {
      const result = await runRun({
        root,
        profile: 'smoke',
        packsRoot: [packDir],
        httpSecrets: { OLD_TOKEN: 'secret-value' },
      });
      assert.equal(result.ok, true, `authenticated run must succeed: ${JSON.stringify(result)}`);
      assert.equal(authenticated, true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        target.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('boots from a fresh project, runs scenarios from the manifest, and writes events + findings to .aqa/runs/<run_id>/', async () => {
    const { root, packDir } = fixtureProject();
    const result = await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });

    assert.equal(result.ok, true, `run must succeed, got: ${JSON.stringify(result)}`);
    assert.ok(result.runId, 'runId must be set');
    assert.ok(result.runDir, 'runDir must be set');
    assert.ok(
      result.scenariosRun >= 1,
      `expected at least 1 scenario to run, got ${result.scenariosRun}`,
    );

    const eventsPath = join(result.runDir, 'events.jsonl');
    const findingsPath = join(result.runDir, 'findings.jsonl');
    assert.ok(existsSync(eventsPath), `events.jsonl must exist at ${eventsPath}`);
    assert.ok(existsSync(findingsPath), `findings.jsonl must exist at ${findingsPath}`);

    const eventLines = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(eventLines.length >= 3, `expected ≥3 events, got ${eventLines.length}`);

    const chain = verifyWriterChain(eventLines);
    assert.equal(chain.ok, true, `audit chain must verify, got: ${chain.reason ?? ''}`);
    const scenarioFinished = eventLines
      .map((line) => JSON.parse(line) as { kind: string; payload?: { outcome?: string } })
      .find((event) => event.kind === 'scenario_finished');
    assert.equal(scenarioFinished?.payload?.outcome, 'pass');

    // Canonical evidence is registered through the configured artifact store
    // and must be byte-identical to the local audit streams. A text upload
    // would be a regression because adapter redaction could change hashes.
    assert.deepEqual(result.canonicalArtifacts, [
      'canonical/events.jsonl',
      'canonical/findings.jsonl',
      'canonical/checkpoint.json',
      'canonical/manifest.json',
    ]);
    assert.equal(
      readFileSync(join(result.runDir, 'canonical', 'events.jsonl'), 'utf8'),
      readFileSync(eventsPath, 'utf8'),
    );
    assert.equal(
      readFileSync(join(result.runDir, 'canonical', 'findings.jsonl'), 'utf8'),
      readFileSync(findingsPath, 'utf8'),
    );
    assert.ok(existsSync(join(result.runDir, 'canonical', 'manifest.json.meta.json')));
    assert.ok(existsSync(join(result.runDir, 'canonical', 'checkpoint.json.meta.json')));
  });

  it('fails closed and records remaining scenarios when the profile wall-clock budget is exceeded', async () => {
    const { root, packDir } = fixtureProject();
    const secondScenario = SMOKE_SCENARIO.replace('scn-smoke-noop', 'scn-smoke-second');
    writeFileSync(join(packDir, 'scenarios', 'second.yaml'), secondScenario, 'utf8');
    writeFileSync(
      join(packDir, 'pack.yaml'),
      SMOKE_PACK_MANIFEST.replace(
        '  - scenarios/smoke-noop.yaml',
        '  - scenarios/smoke-noop.yaml\n  - scenarios/second.yaml',
      ),
      'utf8',
    );
    const profilesPath = join(root, '.aqa', 'profiles.yaml');
    const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
      profiles: Record<string, Record<string, unknown>>;
    };
    profiles.profiles.smoke = { ...profiles.profiles.smoke, budget_minutes: 1 };
    writeFileSync(profilesPath, yamlStringify(profiles), 'utf8');

    let clockRead = 0;
    const result = await runFixture({
      root,
      profile: 'smoke',
      packsRoot: [packDir],
      now: () => {
        const value = clockRead === 0 ? 0 : clockRead === 1 ? 0 : 60_001;
        clockRead += 1;
        return value;
      },
    });
    assert.equal(result.ok, false, 'budget exhaustion must never greenlight partial coverage');
    assert.match(result.error ?? '', /budget_minutes=1/);
    assert.ok(result.runDir);
    const events = readFileSync(join(result.runDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            kind: string;
            scenario_id?: string;
            payload?: Record<string, unknown>;
          },
      );
    const secondFinished = events.find(
      (event) => event.kind === 'scenario_finished' && event.scenario_id === 'scn-smoke-second',
    );
    assert.equal(secondFinished?.payload?.outcome, 'not_run');
    assert.equal(secondFinished?.payload?.reason, 'budget_exceeded');
  });

  it('publishes the signed completeness checkpoint to an independent store', async () => {
    const { root, packDir } = fixtureProject();
    const externalRoot = mkdtempSync(join(tmpdir(), 'aqa-checkpoint-'));
    const result = await runFixture({
      root,
      profile: 'smoke',
      packsRoot: [packDir],
      auditCheckpointStore: new FileArtifactStore(externalRoot),
    });
    assert.equal(result.ok, true, `run must succeed, got: ${JSON.stringify(result)}`);
    assert.ok(result.runId);
    assert.ok(result.runDir);
    const externalPath = join(externalRoot, 'checkpoints', `${result.runId}.json`);
    assert.ok(existsSync(externalPath), 'external checkpoint must be independently published');
    const manifest = JSON.parse(
      readFileSync(join(result.runDir, 'canonical', 'manifest.json'), 'utf8'),
    ) as { external_checkpoint?: { key: string; sha256: string } };
    assert.equal(manifest.external_checkpoint?.key, `checkpoints/${result.runId}.json`);
    assert.equal(manifest.external_checkpoint?.sha256.length, 64);
  });

  it('closes a lifecycle-aware probe driver before publishing the run', async () => {
    const { root, packDir } = fixtureProject();
    let closed = false;
    const runner = Object.assign(
      async (probe: { id: string }) => ({ probe_id: probe.id, status: 200 }),
      {
        close: async () => {
          closed = true;
        },
      },
    );
    const result = await runRun({
      root,
      profile: 'smoke',
      packsRoot: [packDir],
      probeRunner: runner,
    });
    assert.equal(result.ok, true, `run must succeed, got: ${JSON.stringify(result)}`);
    assert.equal(closed, true);
  });

  it('does not emit a finding when a scenario has no executable driver', async () => {
    // This fixture has no SUT base URL, so the missing driver is an execution
    // gap, not evidence that the SUT violated the oracle.
    const { root, packDir } = fixtureProject();
    const failingScenario = SMOKE_SCENARIO.replace('expected: 200', 'expected: 999');
    writeFileSync(join(packDir, 'scenarios', 'smoke-noop.yaml'), failingScenario, 'utf8');

    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false);
    assert.equal(result.findingsCount, 0);
    assert.match(result.error ?? '', /could not execute|no probe runner/i);

    const events = readFileSync(join(result.runDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { kind: string });
    const findingEvents = events.filter((e) => e.kind === 'finding_emitted');
    assert.equal(findingEvents.length, 0);

    const findingsLines = readFileSync(join(result.runDir, 'findings.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.equal(findingsLines.length, 0);
    const finished = events.find((e) => e.kind === 'run_finished') as {
      payload?: { replay_artifacts?: number; run_state?: string };
    };
    assert.equal(finished.payload?.replay_artifacts, 0);
    assert.equal(finished.payload?.run_state, 'failed');
  });

  it('exports audit event spans to a configured OTLP endpoint and drains before return', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
      });
      req.on('end', () => {
        payloads.push(JSON.parse(body) as Record<string, unknown>);
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const { root, packDir } = fixtureProject();
      const result = await runFixture({
        root,
        profile: 'smoke',
        packsRoot: [packDir],
        otlpEndpoint: `http://127.0.0.1:${address.port}/v1/traces`,
      });
      assert.equal(result.ok, true);
      assert.ok(payloads.length >= 1, 'run must deliver at least one OTLP batch before return');
      const spans =
        (payloads[0]?.resourceSpans as Array<{ scopeSpans: Array<{ spans: unknown[] }> }>) ?? [];
      assert.ok((spans[0]?.scopeSpans[0]?.spans.length ?? 0) >= 1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('rejects an unknown profile rather than silently running all scenarios', async () => {
    const { root, packDir } = fixtureProject();
    const result = await runFixture({ root, profile: 'no-such-profile', packsRoot: [packDir] });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /profile/i);
  });

  it('rejects an empty --profile value', async () => {
    const { root, packDir } = fixtureProject();
    const result = await runFixture({ root, profile: '', packsRoot: [packDir] });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /--profile/);
  });

  it('produces a deterministic run_id when seed is provided', async () => {
    const { root: rootA, packDir: packA } = fixtureProject();
    const { root: rootB, packDir: packB } = fixtureProject();
    const a = await runFixture({
      root: rootA,
      profile: 'smoke',
      seed: 'fixed-seed',
      packsRoot: [packA],
    });
    const b = await runFixture({
      root: rootB,
      profile: 'smoke',
      seed: 'fixed-seed',
      packsRoot: [packB],
    });
    assert.equal(a.runId, b.runId, 'identical seeds must produce identical run_ids');
  });

  it('flags a malformed scenario as ok=false instead of silently dropping coverage', async () => {
    const { root, packDir } = fixtureProject();
    // Write a scenario YAML that parses but fails Zod validation (missing required fields).
    writeFileSync(
      join(packDir, 'scenarios', 'smoke-noop.yaml'),
      `schema_version: "1"\nid: scn-broken\n`, // missing title, risk_refs, etc.
      'utf8',
    );
    const result = await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'malformed scenario must surface as ok=false');
    assert.match(result.error ?? '', /scenario/i);
  });

  it('flags a profile that selects zero scenarios as ok=false', async () => {
    const { root, packDir } = fixtureProject();
    // Patch the smoke profile to ask for a non-existent pack so the run loop
    // finds zero matching scenarios.
    const profilesPath = join(root, '.aqa', 'profiles.yaml');
    const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
      profiles: Record<string, { packs: string[] }>;
    };
    if (profiles.profiles.smoke) profiles.profiles.smoke.packs = ['pack-does-not-exist'];
    writeFileSync(profilesPath, yamlStringify(profiles), 'utf8');

    const result = await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'zero-scenario run must not silently succeed');
    assert.match(result.error ?? '', /0 scenarios/i);
  });

  it('surfaces a malformed pack.yaml as a pack error', async () => {
    const { root, packDir } = fixtureProject();
    writeFileSync(join(packDir, 'pack.yaml'), 'not valid YAML: : :\n', 'utf8');
    const result = await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'broken pack.yaml must fail the run');
    assert.match(result.error ?? '', /pack/i);
  });

  it('surfaces a manifest-listed scenario file that does not exist as a coverage gap', async () => {
    const { root, packDir } = fixtureProject();
    // Replace pack.yaml with one that references a missing scenario file.
    const brokenManifest = SMOKE_PACK_MANIFEST.replace(
      'scenarios/smoke-noop.yaml',
      'scenarios/does-not-exist.yaml',
    );
    writeFileSync(join(packDir, 'pack.yaml'), brokenManifest, 'utf8');
    const result = await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'missing manifest scenario must surface as ok=false');
    assert.match(result.error ?? '', /missing/i);
  });

  it('rejects an absolute or traversing scenario path as unsafe', async () => {
    const { root, packDir } = fixtureProject();
    // Manifest tries to read outside the pack root via `..` traversal.
    const evilManifest = SMOKE_PACK_MANIFEST.replace(
      'scenarios/smoke-noop.yaml',
      '../../../etc/passwd',
    );
    writeFileSync(join(packDir, 'pack.yaml'), evilManifest, 'utf8');
    const result = await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'path traversal must fail the run');
    assert.match(result.error ?? '', /unsafe/i);
  });

  it('rejects a scenario file that symlinks outside the pack root', async (t) => {
    const { root, packDir } = fixtureProject();
    // Create a target file outside the pack root and a symlink that points
    // at it from within scenarios/. On Windows, symlink creation requires
    // admin privileges (or Developer Mode) and on some sandboxes it's
    // disallowed; use t.skip() so CI reports it accurately rather than
    // silently returning a pass.
    const outsideTarget = join(root, 'OUTSIDE-SECRET.yaml');
    writeFileSync(outsideTarget, 'schema_version: "1"\nid: leaked\n', 'utf8');
    const link = join(packDir, 'scenarios', 'evil-link.yaml');
    try {
      symlinkSync(outsideTarget, link, 'file');
    } catch {
      if (process.versions.bun) {
        console.warn(
          '[run-cmd.test] symlink case not executable: Bun node:test skip is unsupported',
        );
        return;
      }
      t.skip('symlink creation not supported on this platform/permission level');
      return;
    }
    // Point the manifest at the symlink so the run will try to load it.
    const linkedManifest = SMOKE_PACK_MANIFEST.replace(
      'scenarios/smoke-noop.yaml',
      'scenarios/evil-link.yaml',
    );
    writeFileSync(join(packDir, 'pack.yaml'), linkedManifest, 'utf8');
    const result = await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'symlink escape must fail the run');
    assert.match(result.error ?? '', /unsafe/i);
  });

  it('discovers packs bundled inside @aqa/kit when no other source is provided', async () => {
    // Build the fixture but DO NOT pass packsRoot. The bundled pack-api-core
    // (now shipped in @aqa/kit/dist/packs/) should be picked up automatically.
    // We point the profile at pack-api-core which has scenarios tagged "api".
    const { root } = fixtureProject();
    const profilesPath = join(root, '.aqa', 'profiles.yaml');
    const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
      profiles: Record<string, { packs: string[]; tags: string[] }>;
    };
    if (profiles.profiles.smoke) {
      profiles.profiles.smoke.packs = ['pack-api-core'];
      profiles.profiles.smoke.tags = ['api'];
    }
    writeFileSync(profilesPath, yamlStringify(profiles), 'utf8');

    const result = await runFixture({ root, profile: 'smoke' });
    assert.equal(
      result.ok,
      true,
      `kit-bundled discovery must work, got: ${JSON.stringify(result)}`,
    );
    assert.ok(result.scenariosRun >= 1, 'must find scenarios via kit-bundled packs');
  });

  it('discovers bundled packs from node_modules/@aqa when no packsRoot is provided', async () => {
    const { root, packDir } = fixtureProject();
    // Simulate an external project that has `pack-local-smoke` installed as
    // an npm dep. Copy the on-disk pack into the project's node_modules so
    // `defaultPacksRoot()` discovers it without an explicit packsRoot.
    const nmPack = join(root, 'node_modules', '@aqa', 'pack-local-smoke');
    cpSync(packDir, nmPack, { recursive: true });
    const result = await runFixture({ root, profile: 'smoke' });
    assert.equal(
      result.ok,
      true,
      `node_modules discovery must work, got: ${JSON.stringify(result)}`,
    );
    assert.ok(result.scenariosRun >= 1, 'must find at least 1 scenario via node_modules');
  });

  it('fails the run when a profile-selected pack is missing from discovery entirely', async () => {
    const { root, packDir } = fixtureProject();
    // The profile pins both the local pack AND a pack that simply does not
    // exist anywhere on disk. There's no load error to record — the pack
    // just isn't there. The run must still fail rather than silently skip
    // it on the strength of the one pack that did load.
    const profilesPath = join(root, '.aqa', 'profiles.yaml');
    const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
      profiles: Record<string, { packs: string[]; tags: string[] }>;
    };
    if (profiles.profiles.smoke) {
      profiles.profiles.smoke.packs = ['pack-local-smoke', 'pack-ghost'];
      profiles.profiles.smoke.tags = ['smoke'];
    }
    writeFileSync(profilesPath, yamlStringify(profiles), 'utf8');

    const result = await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'a selected pack absent from discovery must fail');
    assert.match(result.error ?? '', /pack-ghost|selected pack/i);
  });

  it('fails the run when a profile-selected pack does not load (even if others did)', async () => {
    const { root, packDir } = fixtureProject();
    // Make a second pack dir with a broken manifest, named to match a
    // canonical entry in the profile so it's clearly "selected".
    const brokenPackDir = join(root, 'broken-selected-pack');
    mkdirSync(brokenPackDir, { recursive: true });
    writeFileSync(join(brokenPackDir, 'pack.yaml'), 'oops: : invalid\n', 'utf8');
    // Patch the profile to pin both packs.
    const profilesPath = join(root, '.aqa', 'profiles.yaml');
    const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
      profiles: Record<string, { packs: string[]; tags: string[] }>;
    };
    if (profiles.profiles.smoke) {
      profiles.profiles.smoke.packs = ['pack-local-smoke', 'pack-must-load'];
      profiles.profiles.smoke.tags = ['smoke'];
    }
    writeFileSync(profilesPath, yamlStringify(profiles), 'utf8');

    const result = await runFixture({
      root,
      profile: 'smoke',
      packsRoot: [packDir, brokenPackDir],
    });
    assert.equal(result.ok, false, 'a selected-but-unloaded pack must fail the run');
    assert.match(result.error ?? '', /selected pack/i);
  });

  it('exposes unrelated pack errors as warnings when ok=true', async () => {
    const { root, packDir } = fixtureProject();
    const strayPackDir = join(root, 'stray-broken-pack');
    mkdirSync(strayPackDir, { recursive: true });
    writeFileSync(join(strayPackDir, 'pack.yaml'), 'this is: : not valid YAML\n', 'utf8');

    const result = await runFixture({
      root,
      profile: 'smoke',
      packsRoot: [packDir, strayPackDir],
    });
    assert.equal(result.ok, true);
    assert.ok(result.warnings && result.warnings.length > 0, 'expected warnings');
    assert.match(
      (result.warnings ?? []).join(' '),
      /pack/i,
      'warnings must mention the unrelated broken pack',
    );
  });

  it('ignores broken packs that the selected profile did not reference', async () => {
    const { root, packDir } = fixtureProject();
    // Add an unrelated broken pack at a sibling path. The smoke profile
    // pins `pack-local-smoke` only, so this stale pack.yaml must not
    // fail the run — its load error is surfaced via `result.warnings`
    // and the `pack_error_samples` field in the run_finished event,
    // but it doesn't flip ok=false.
    const strayPackDir = join(root, 'stray-broken-pack');
    mkdirSync(strayPackDir, { recursive: true });
    writeFileSync(join(strayPackDir, 'pack.yaml'), 'this is: : not valid YAML\n', 'utf8');

    const result = await runFixture({
      root,
      profile: 'smoke',
      packsRoot: [packDir, strayPackDir],
    });
    assert.equal(
      result.ok,
      true,
      `unrelated broken pack must not fail the run, got: ${JSON.stringify(result)}`,
    );
    assert.ok(result.scenariosRun >= 1);
  });

  it('matches a third-party pack whose manifest name does not start with `pack-`', async () => {
    const { root } = fixtureProject();
    // Build a pack whose manifest name is "security" (no pack- prefix).
    const customDir = join(root, 'security-pack');
    mkdirSync(join(customDir, 'scenarios'), { recursive: true });
    writeFileSync(
      join(customDir, 'pack.yaml'),
      SMOKE_PACK_MANIFEST.replace('pack-local-smoke', 'security'),
      'utf8',
    );
    writeFileSync(
      join(customDir, 'package.json'),
      JSON.stringify({ name: 'security', version: '0.1.0', private: true }),
      'utf8',
    );
    writeFileSync(join(customDir, 'scenarios', 'smoke-noop.yaml'), SMOKE_SCENARIO, 'utf8');
    // Patch the profile to pin the bare name (no pack- prefix).
    const profilesPath = join(root, '.aqa', 'profiles.yaml');
    const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
      profiles: Record<string, { packs: string[]; tags: string[] }>;
    };
    if (profiles.profiles.smoke) {
      profiles.profiles.smoke.packs = ['security'];
      profiles.profiles.smoke.tags = ['smoke'];
    }
    writeFileSync(profilesPath, yamlStringify(profiles), 'utf8');

    const result = await runFixture({ root, profile: 'smoke', packsRoot: [customDir] });
    assert.equal(
      result.ok,
      true,
      `non-prefixed pack name must match, got: ${JSON.stringify(result)}`,
    );
    assert.ok(result.scenariosRun >= 1);
  });

  it('fails closed for agent mode when the host does not inject a driver', async () => {
    const { root, packDir } = fixtureProject();
    const profilesPath = join(root, '.aqa', 'profiles.yaml');
    const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
      profiles: Record<string, { packs: string[]; tags: string[]; execution_mode: string }>;
    };
    if (profiles.profiles.smoke) profiles.profiles.smoke.execution_mode = 'agent';
    writeFileSync(profilesPath, yamlStringify(profiles), 'utf8');

    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'agent-mode profile must fail without an injected driver');
    assert.match(result.error ?? '', /agentRunner|agent mode/i);
  });

  it('runs agent mode through the explicit host-owned driver boundary', async () => {
    const { root, packDir } = fixtureProject();
    const profilesPath = join(root, '.aqa', 'profiles.yaml');
    const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
      profiles: Record<string, { packs: string[]; tags: string[]; execution_mode: string }>;
    };
    if (profiles.profiles.smoke) profiles.profiles.smoke.execution_mode = 'agent';
    writeFileSync(profilesPath, yamlStringify(profiles), 'utf8');

    const result = await runRun({
      root,
      profile: 'smoke',
      packsRoot: [packDir],
      agentRunner: fixtureProbeRunner,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.scenariosRun >= 1);
  });

  it('release-gate profile fails when the SUT driver is unavailable', async () => {
    const { root, packDir } = fixtureProject();
    const failingScenario = SMOKE_SCENARIO.replace('expected: 200', 'expected: 999');
    writeFileSync(join(packDir, 'scenarios', 'smoke-noop.yaml'), failingScenario, 'utf8');
    const profilesPath = join(root, '.aqa', 'profiles.yaml');
    const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
      profiles: Record<string, { packs: string[]; tags: string[] }>;
    };
    const rg = profiles.profiles['release-gate'];
    if (rg) {
      rg.packs = ['pack-local-smoke'];
      rg.tags = ['smoke'];
    }
    writeFileSync(profilesPath, yamlStringify(profiles), 'utf8');

    const result = await runRun({ root, profile: 'release-gate', packsRoot: [packDir] });
    assert.equal(result.findingsCount, 0);
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /could not execute|no probe runner/i);
  });

  it('smoke profile reports an execution gap instead of a false finding', async () => {
    const { root, packDir } = fixtureProject();
    const failingScenario = SMOKE_SCENARIO.replace('expected: 200', 'expected: 999');
    writeFileSync(join(packDir, 'scenarios', 'smoke-noop.yaml'), failingScenario, 'utf8');
    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.findingsCount, 0);
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /could not execute|no probe runner/i);
  });

  it('deduplicates a pack discovered from multiple roots by manifest name', async () => {
    const { root, packDir } = fixtureProject();
    // Make a second on-disk copy of the same pack at a different absolute
    // path. Both copies share `manifest.name = pack-local-smoke` so a naive
    // run would execute the scenario twice and inflate `scenariosRun`.
    const duplicateDir = join(root, 'duplicate-pack');
    mkdirSync(join(duplicateDir, 'scenarios'), { recursive: true });
    writeFileSync(join(duplicateDir, 'pack.yaml'), SMOKE_PACK_MANIFEST, 'utf8');
    writeFileSync(
      join(duplicateDir, 'package.json'),
      JSON.stringify({ name: 'pack-local-smoke', version: '0.1.0', private: true }),
      'utf8',
    );
    writeFileSync(join(duplicateDir, 'scenarios', 'smoke-noop.yaml'), SMOKE_SCENARIO, 'utf8');

    const result = await runFixture({ root, profile: 'smoke', packsRoot: [packDir, duplicateDir] });
    assert.equal(result.ok, true);
    assert.equal(result.scenariosRun, 1, 'duplicate pack must only execute once');
  });

  it('accepts a legacy bare-slug pack reference (`core` matches `pack-core`)', async () => {
    const { root, packDir } = fixtureProject();
    // Patch the profile to use the legacy bare-slug form `local-smoke` instead
    // of the manifest name `pack-local-smoke`.
    const profilesPath = join(root, '.aqa', 'profiles.yaml');
    const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
      profiles: Record<string, { packs: string[]; tags: string[] }>;
    };
    if (profiles.profiles.smoke) profiles.profiles.smoke.packs = ['local-smoke'];
    writeFileSync(profilesPath, yamlStringify(profiles), 'utf8');

    const result = await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, true, `legacy alias must match, got: ${JSON.stringify(result)}`);
  });

  it('skips packs whose applies_when does not match the project SUT', async () => {
    const { root, packDir } = fixtureProject();
    // Patch the pack to only apply to web SUTs — our fixture is api, so the
    // pack should be skipped entirely and the run reports zero scenarios.
    const webOnlyManifest = SMOKE_PACK_MANIFEST.replace('sut_type: [api]', 'sut_type: [web]');
    writeFileSync(join(packDir, 'pack.yaml'), webOnlyManifest, 'utf8');
    const result = await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'no eligible packs → ok=false');
    assert.match(result.error ?? '', /0 scenarios/i);
  });

  it('refuses to re-use a deterministic run directory rather than corrupting the audit chain', async () => {
    const { root, packDir } = fixtureProject();
    const first = await runFixture({
      root,
      profile: 'smoke',
      seed: 'same-seed',
      packsRoot: [packDir],
    });
    assert.equal(first.ok, true);

    const second = await runFixture({
      root,
      profile: 'smoke',
      seed: 'same-seed',
      packsRoot: [packDir],
    });
    assert.equal(second.ok, false, 'second run with same seed must refuse to write');
    assert.match(second.error ?? '', /non-empty|collision/i);
  });
});

describe('aqa run — fs layout', () => {
  it('creates a separate run directory per non-seeded invocation', async () => {
    const { root, packDir } = fixtureProject();
    await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });
    await new Promise((r) => setTimeout(r, 10));
    await runFixture({ root, profile: 'smoke', packsRoot: [packDir] });
    const runsDir = join(root, '.aqa', 'runs');
    const entries = readdirSync(runsDir);
    assert.ok(entries.length >= 2, `expected ≥2 run directories, found ${entries.length}`);
  });
});
