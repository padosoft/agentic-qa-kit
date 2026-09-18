import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { Scenario } from '@aqa/schemas';
import { parse as yamlParse } from 'yaml';
import { loadPack, loadPacks } from '../dist/loader.js';
import { loadPackResources, resolvePackScenario } from '../dist/resources.js';

function temp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'aqa-pack-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

const MIN_VALID = `schema_version: "1"
name: pack-x
version: 0.1.0
description: "minimal"
author: tester
`;

describe('loadPack', () => {
  it('loads a valid pack.yaml', () => {
    const root = temp({ 'pack.yaml': MIN_VALID });
    const pack = loadPack(root);
    assert.equal(pack.manifest.name, 'pack-x');
    assert.equal(pack.manifest.version, '0.1.0');
    assert.equal(pack.root, root);
  });

  it('rejects an invalid pack.yaml with a descriptive error', () => {
    const root = temp({
      'pack.yaml': `schema_version: "1"\nname: BAD CASE\nversion: not-semver\ndescription: x\nauthor: a\n`,
    });
    assert.throws(() => loadPack(root), /invalid manifest/);
  });

  it('throws when no manifest is present', () => {
    const root = temp({ 'placeholder.txt': '' });
    assert.throws(() => loadPack(root), /no manifest/);
  });
});

describe('loadPacks', () => {
  it('loads every direct subdirectory that contains a manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-packs-'));
    for (const name of ['core', 'api-core', 'web-ui']) {
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'pack.yaml'),
        MIN_VALID.replace('name: pack-x', `name: pack-${name}`),
        'utf8',
      );
    }
    // an empty dir that should be skipped
    mkdirSync(join(root, 'not-a-pack'), { recursive: true });

    const packs = loadPacks(root);
    const names = packs.map((p) => p.manifest.name).sort();
    assert.deepEqual(names, ['pack-api-core', 'pack-core', 'pack-web-ui']);
  });
});

describe('pack resources', () => {
  it('ships the GDPR enterprise pack with schema-valid scenarios', () => {
    const root = join(process.cwd(), 'packs', 'compliance-gdpr');
    const pack = loadPack(root);
    const resources = loadPackResources(pack);
    for (const scenarioPath of pack.manifest.scenarios ?? []) {
      const scenario = Scenario.Scenario.parse(
        yamlParse(readFileSync(join(root, scenarioPath), 'utf8')),
      );
      assert.ok(scenario.oracles.length > 0);
      assert.equal(scenario.risk_refs.length, 1);
    }
    assert.equal(resources.probes.size, 0);
  });

  it('loads and expands manifest-declared probe and oracle references', () => {
    const root = temp({
      'pack.yaml': `${MIN_VALID}probes: [probes/health.yaml]\noracles: [oracles/status.yaml]\n`,
      'probes/health.yaml': 'id: health\nkind: http\nwith: { method: GET, url: /healthz }\n',
      'oracles/status.yaml': 'id: healthy\nkind: http_status\nwith: { expected: 200 }\n',
    });
    const pack = loadPack(root);
    const resources = loadPackResources(pack);
    const scenario = resolvePackScenario(
      {
        schema_version: '1',
        id: 'scn-health',
        title: 'Health check',
        risk_refs: ['risk-health'],
        invariant_refs: [],
        preconditions: [],
        steps: [{ id: 'step', kind: 'custom', with: { ref: 'health' }, timeout_ms: 30_000 }],
        oracles: [{ id: 'check', kind: 'custom', with: { ref: 'healthy' }, weight: 1 }],
        cleanup: [],
        tags: [],
      },
      resources,
    );
    assert.equal(scenario.steps[0]?.kind, 'http');
    assert.equal(scenario.steps[0]?.with.url, '/healthz');
    assert.equal(scenario.oracles[0]?.kind, 'http_status');
  });

  it('fails closed for missing, duplicate and unsafe resource declarations', () => {
    const missing = temp({ 'pack.yaml': `${MIN_VALID}probes: [probes/missing.yaml]\n` });
    assert.throws(() => loadPackResources(loadPack(missing)), /resource file is missing/);

    const duplicate = temp({
      'pack.yaml': `${MIN_VALID}probes: [a.yaml, b.yaml]\n`,
      'a.yaml': 'id: same\nkind: http\n',
      'b.yaml': 'id: same\nkind: http\n',
    });
    assert.throws(() => loadPackResources(loadPack(duplicate)), /duplicate custom probe id/);

    const unsafe = temp({ 'pack.yaml': `${MIN_VALID}probes: [../outside.yaml]\n` });
    assert.throws(() => loadPackResources(loadPack(unsafe)), /escapes pack root/);
  });

  it('rejects custom references with parameters or unknown ids', () => {
    const root = temp({ 'pack.yaml': MIN_VALID });
    const resources = loadPackResources(loadPack(root));
    const scenario = {
      schema_version: '1' as const,
      id: 'scn-health',
      title: 'Health check',
      risk_refs: ['risk-health'],
      invariant_refs: [],
      preconditions: [],
      steps: [{ id: 'step', kind: 'custom' as const, with: { ref: 'unknown', method: 'GET' } }],
      oracles: [{ id: 'check', kind: 'http_status' as const, with: { expected: 200 }, weight: 1 }],
      cleanup: [],
      tags: [],
    };
    assert.throws(() => resolvePackScenario(scenario, resources), /requires only with\.ref/);
  });
});
