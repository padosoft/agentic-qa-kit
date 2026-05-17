import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parse as yamlParse } from 'yaml';
import { runDoctor } from '../dist/commands/doctor.js';
import { runInit } from '../dist/commands/init.js';
import { runValidate } from '../dist/commands/validate.js';

function makeTempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'aqa-cli-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

describe('aqa init', () => {
  it('creates the four .aqa/ scaffolding files in a fresh repo', async () => {
    const root = makeTempProject({
      'package.json': JSON.stringify({ name: 'demo', dependencies: { hono: '^4.0.0' } }),
      'bun.lock': '',
    });
    const result = await runInit({ root });
    const created = result.files.filter((f) => f.result === 'created').map((f) => f.path);
    assert.equal(created.length, 4);
    assert.ok(existsSync(join(root, '.aqa', 'project.yaml')));
    assert.ok(existsSync(join(root, '.aqa', 'profiles.yaml')));
    assert.ok(existsSync(join(root, '.aqa', 'risk-map.yaml')));
    assert.ok(existsSync(join(root, '.aqa', 'testing.md')));
  });

  it('skips existing files without overwrite', async () => {
    const root = makeTempProject({
      'package.json': '{}',
      '.aqa/project.yaml': 'schema_version: "1"\nname: existing\n',
    });
    const result = await runInit({ root });
    const skipped = result.files.find((f) => f.path.endsWith('project.yaml'));
    assert.equal(skipped?.result, 'skipped-exists');
  });

  it('overwrites with force=true', async () => {
    const root = makeTempProject({
      'package.json': '{}',
      '.aqa/project.yaml': 'schema_version: "1"\nname: existing\n',
    });
    const result = await runInit({ root, overwrite: true });
    const overwritten = result.files.find((f) => f.path.endsWith('project.yaml'));
    assert.equal(overwritten?.result, 'overwritten');
  });

  it('dry-run does not write to disk', async () => {
    const root = makeTempProject({ 'package.json': '{}' });
    await runInit({ root, dryRun: true });
    assert.equal(existsSync(join(root, '.aqa', 'project.yaml')), false);
  });

  it('init output validates against @aqa/schemas', async () => {
    const root = makeTempProject({ 'package.json': JSON.stringify({ name: 'demo' }) });
    await runInit({ root });
    const result = runValidate({ root });
    assert.equal(result.ok, true, `validation must pass, got: ${JSON.stringify(result.issues)}`);
    assert.equal(result.checked.length, 3);
  });

  it('produces a profile.runtime that matches the project signals', async () => {
    const root = makeTempProject({ 'package.json': '{}', 'deno.json': '{}' });
    const result = await runInit({ root });
    assert.equal(result.profile.runtime, 'deno');
    const project = yamlParse(readFileSync(join(root, '.aqa', 'project.yaml'), 'utf8')) as {
      stack: { runtime: string };
    };
    assert.equal(project.stack.runtime, 'deno');
  });
});

describe('aqa doctor', () => {
  it('worst=warn when .aqa is missing', () => {
    const root = makeTempProject({ 'package.json': '{}' });
    const d = runDoctor({ root });
    assert.equal(d.worst, 'warn');
    const aqaCheck = d.checks.find((c) => c.id === 'aqa-dir');
    assert.equal(aqaCheck?.status, 'warn');
  });

  it('worst=pass after a clean aqa init', async () => {
    const root = makeTempProject({
      'package.json': JSON.stringify({ name: 'demo', devDependencies: { vitest: '^1.0.0' } }),
      'bun.lock': '',
      'AGENTS.md': '# agents',
    });
    await runInit({ root });
    const d = runDoctor({ root });
    assert.notEqual(d.worst, 'fail', `doctor must not fail, got: ${JSON.stringify(d.checks)}`);
  });

  it('flags aqa-validate=fail when .aqa is malformed', async () => {
    const root = makeTempProject({
      'package.json': '{}',
      '.aqa/project.yaml': 'schema_version: "1"\nname: not a slug because spaces\n',
      '.aqa/risk-map.yaml': 'schema_version: "1"\nproject: demo\nrisks: []\n',
      '.aqa/profiles.yaml': 'schema_version: "1"\nprofiles: {}\n',
    });
    const d = runDoctor({ root });
    const v = d.checks.find((c) => c.id === 'aqa-validate');
    assert.equal(v?.status, 'fail');
  });
});

describe('aqa validate', () => {
  it('rejects malformed project.yaml with a precise path', () => {
    const root = makeTempProject({
      '.aqa/project.yaml':
        'schema_version: "1"\nname: demo\nstack:\n  runtime: invented\nsut:\n  type: api\n',
      '.aqa/risk-map.yaml':
        'schema_version: "1"\nproject: demo\nrisks:\n  - id: r1\n    category: auth\n    title: example\n    severity: high\n    likelihood: possible\n',
      '.aqa/profiles.yaml': 'schema_version: "1"\nprofiles: {}\n',
    });
    const r = runValidate({ root });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.file === '.aqa/project.yaml' && i.path.includes('runtime')));
  });

  it('passes on the canonical aqa init output', async () => {
    const root = makeTempProject({ 'package.json': JSON.stringify({ name: 'demo' }) });
    await runInit({ root });
    const r = runValidate({ root });
    assert.equal(r.ok, true);
  });
});
