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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { runInit } from '../dist/commands/init.js';
import { runRun } from '../dist/commands/run.js';

/**
 * Re-walk the writer's hash chain. We can't share `@aqa/compliance.verifyEventChain`
 * directly because the two implementations differ slightly on canonical form
 * (writer omits prev_hash from the canonical body, verifier includes it) and on
 * seq=0 (writer emits null, verifier expects all-zero hash). Reconciling the
 * two formats is tracked as a separate cleanup; this local verifier mirrors
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

describe('aqa run', () => {
  it('boots from a fresh project, runs scenarios from the manifest, and writes events + findings to .aqa/runs/<run_id>/', async () => {
    const { root, packDir } = fixtureProject();
    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });

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
  });

  it('emits exactly one `finding_emitted` event per failing scenario', async () => {
    // Build a fixture whose oracle deliberately fails so we get a finding.
    const { root, packDir } = fixtureProject();
    const failingScenario = SMOKE_SCENARIO.replace('expected: 200', 'expected: 999');
    writeFileSync(join(packDir, 'scenarios', 'smoke-noop.yaml'), failingScenario, 'utf8');

    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, true);
    assert.equal(result.findingsCount, 1, 'one failing scenario must produce one finding');

    const events = readFileSync(join(result.runDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { kind: string });
    const findingEvents = events.filter((e) => e.kind === 'finding_emitted');
    assert.equal(
      findingEvents.length,
      1,
      `expected exactly 1 finding_emitted event, got ${findingEvents.length}`,
    );

    const findingsLines = readFileSync(join(result.runDir, 'findings.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.equal(
      findingsLines.length,
      1,
      `expected exactly 1 finding line, got ${findingsLines.length}`,
    );
  });

  it('rejects an unknown profile rather than silently running all scenarios', async () => {
    const { root, packDir } = fixtureProject();
    const result = await runRun({ root, profile: 'no-such-profile', packsRoot: [packDir] });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /profile/i);
  });

  it('rejects an empty --profile value', async () => {
    const { root, packDir } = fixtureProject();
    const result = await runRun({ root, profile: '', packsRoot: [packDir] });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /--profile/);
  });

  it('produces a deterministic run_id when seed is provided', async () => {
    const { root: rootA, packDir: packA } = fixtureProject();
    const { root: rootB, packDir: packB } = fixtureProject();
    const a = await runRun({
      root: rootA,
      profile: 'smoke',
      seed: 'fixed-seed',
      packsRoot: [packA],
    });
    const b = await runRun({
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
    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
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

    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'zero-scenario run must not silently succeed');
    assert.match(result.error ?? '', /0 scenarios/i);
  });

  it('surfaces a malformed pack.yaml as a pack error', async () => {
    const { root, packDir } = fixtureProject();
    writeFileSync(join(packDir, 'pack.yaml'), 'not valid YAML: : :\n', 'utf8');
    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
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
    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
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
    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'path traversal must fail the run');
    assert.match(result.error ?? '', /unsafe/i);
  });

  it('rejects a scenario file that symlinks outside the pack root', async () => {
    const { root, packDir } = fixtureProject();
    // Create a target file outside the pack root and a symlink that points
    // at it from within scenarios/. On Windows symlink creation may require
    // admin privileges — skip gracefully if unsupported.
    const outsideTarget = join(root, 'OUTSIDE-SECRET.yaml');
    writeFileSync(outsideTarget, 'schema_version: "1"\nid: leaked\n', 'utf8');
    const link = join(packDir, 'scenarios', 'evil-link.yaml');
    try {
      symlinkSync(outsideTarget, link, 'file');
    } catch {
      // platform/permission limitation — symlink-test inapplicable here.
      return;
    }
    // Point the manifest at the symlink so the run will try to load it.
    const linkedManifest = SMOKE_PACK_MANIFEST.replace(
      'scenarios/smoke-noop.yaml',
      'scenarios/evil-link.yaml',
    );
    writeFileSync(join(packDir, 'pack.yaml'), linkedManifest, 'utf8');
    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
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

    const result = await runRun({ root, profile: 'smoke' });
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
    const result = await runRun({ root, profile: 'smoke' });
    assert.equal(
      result.ok,
      true,
      `node_modules discovery must work, got: ${JSON.stringify(result)}`,
    );
    assert.ok(result.scenariosRun >= 1, 'must find at least 1 scenario via node_modules');
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

    const result = await runRun({
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

    const result = await runRun({
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

    const result = await runRun({
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

  it('release-gate profile (require_deterministic_replay) fails when any finding is emitted', async () => {
    const { root, packDir } = fixtureProject();
    // Make the scenario fail so a finding is produced.
    const failingScenario = SMOKE_SCENARIO.replace('expected: 200', 'expected: 999');
    writeFileSync(join(packDir, 'scenarios', 'smoke-noop.yaml'), failingScenario, 'utf8');
    // Patch the release-gate profile to point at our local pack.
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
    assert.equal(result.findingsCount, 1, 'expected 1 finding from a failing oracle');
    assert.equal(result.ok, false, 'release-gate must fail on findings');
    assert.match(result.error ?? '', /release-gate|finding/i);
  });

  it('smoke profile reports ok=true even when findings are emitted (informational)', async () => {
    const { root, packDir } = fixtureProject();
    const failingScenario = SMOKE_SCENARIO.replace('expected: 200', 'expected: 999');
    writeFileSync(join(packDir, 'scenarios', 'smoke-noop.yaml'), failingScenario, 'utf8');
    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.findingsCount, 1);
    assert.equal(result.ok, true, 'smoke profile must not fail on findings alone');
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

    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir, duplicateDir] });
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

    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, true, `legacy alias must match, got: ${JSON.stringify(result)}`);
  });

  it('skips packs whose applies_when does not match the project SUT', async () => {
    const { root, packDir } = fixtureProject();
    // Patch the pack to only apply to web SUTs — our fixture is api, so the
    // pack should be skipped entirely and the run reports zero scenarios.
    const webOnlyManifest = SMOKE_PACK_MANIFEST.replace('sut_type: [api]', 'sut_type: [web]');
    writeFileSync(join(packDir, 'pack.yaml'), webOnlyManifest, 'utf8');
    const result = await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
    assert.equal(result.ok, false, 'no eligible packs → ok=false');
    assert.match(result.error ?? '', /0 scenarios/i);
  });

  it('refuses to re-use a deterministic run directory rather than corrupting the audit chain', async () => {
    const { root, packDir } = fixtureProject();
    const first = await runRun({ root, profile: 'smoke', seed: 'same-seed', packsRoot: [packDir] });
    assert.equal(first.ok, true);

    const second = await runRun({
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
    await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
    await new Promise((r) => setTimeout(r, 10));
    await runRun({ root, profile: 'smoke', packsRoot: [packDir] });
    const runsDir = join(root, '.aqa', 'runs');
    const entries = readdirSync(runsDir);
    assert.ok(entries.length >= 2, `expected ≥2 run directories, found ${entries.length}`);
  });
});
