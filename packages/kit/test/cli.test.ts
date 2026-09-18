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

function withEnvironment(values: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('aqa init', () => {
  it('creates the four .aqa/ scaffolding files in a fresh repo', async () => {
    const root = makeTempProject({
      'package.json': JSON.stringify({ name: 'demo', dependencies: { hono: '^4.0.0' } }),
      'bun.lock': '',
    });
    const result = runInit({ root });
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
    const result = runInit({ root });
    const skipped = result.files.find((f) => f.path.endsWith('project.yaml'));
    assert.equal(skipped?.result, 'skipped-exists');
  });

  it('overwrites with force=true', async () => {
    const root = makeTempProject({
      'package.json': '{}',
      '.aqa/project.yaml': 'schema_version: "1"\nname: existing\n',
    });
    const result = runInit({ root, overwrite: true });
    const overwritten = result.files.find((f) => f.path.endsWith('project.yaml'));
    assert.equal(overwritten?.result, 'overwritten');
  });

  it('dry-run does not write to disk', async () => {
    const root = makeTempProject({ 'package.json': '{}' });
    runInit({ root, dryRun: true });
    assert.equal(existsSync(join(root, '.aqa', 'project.yaml')), false);
  });

  it('init output validates against @aqa/schemas', async () => {
    const root = makeTempProject({ 'package.json': JSON.stringify({ name: 'demo' }) });
    runInit({ root });
    const result = runValidate({ root });
    assert.equal(result.ok, true, `validation must pass, got: ${JSON.stringify(result.issues)}`);
    assert.equal(result.checked.length, 3);
  });

  it('produces a profile.runtime that matches the project signals', async () => {
    const root = makeTempProject({ 'package.json': '{}', 'deno.json': '{}' });
    const result = runInit({ root });
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

  it('worst=pass after a clean aqa init with full project signals', () => {
    const root = makeTempProject({
      'package.json': JSON.stringify({ name: 'demo', devDependencies: { vitest: '^1.0.0' } }),
      'bun.lock': '',
      'AGENTS.md': '# agents',
    });
    runInit({ root });
    const d = runDoctor({ root });
    assert.equal(
      d.worst,
      'pass',
      `doctor worst must be 'pass' on a fully-equipped fixture, got: ${JSON.stringify(d.checks)}`,
    );
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

  it('reports explicit production prerequisites without exposing environment values', () => {
    const root = makeTempProject({ 'package.json': '{}' });
    const d = runDoctor({ root, production: true });
    assert.equal(d.checks.find((c) => c.id === 'production-store')?.status, 'fail');
    assert.equal(d.checks.find((c) => c.id === 'production-artifacts')?.status, 'fail');
    assert.equal(d.checks.find((c) => c.id === 'production-sandbox-image')?.status, 'fail');
    assert.equal(d.checks.find((c) => c.id === 'production-admin-auth')?.status, 'fail');
    assert.equal(d.checks.find((c) => c.id === 'production-evidence')?.status, 'warn');
    assert.ok(d.checks.every((c) => !c.detail.includes('postgres://')));
  });

  it('fails closed for partial OIDC and passes the admin identity check only when complete', () => {
    const root = makeTempProject({ 'package.json': '{}' });
    withEnvironment(
      {
        AQA_OIDC_ENABLED: 'true',
        AQA_OIDC_ISSUER: 'https://idp.example.test',
        AQA_OIDC_CLIENT_ID: 'aqa-admin',
        AQA_OIDC_REDIRECT_URI: 'https://aqa.example.test/auth/callback',
        AQA_OIDC_CLIENT_SECRET: 'test-only-secret',
        AQA_OIDC_SESSION_DSN: 'postgres://user:password@db.example.test/aqa',
      },
      () => {
        const d = runDoctor({ root, production: true });
        const check = d.checks.find((c) => c.id === 'production-admin-auth');
        assert.equal(check?.status, 'pass');
        assert.match(check?.detail ?? '', /shared PostgreSQL/);
        assert.doesNotMatch(check?.detail ?? '', /test-only-secret|postgres:\/\//);
      },
    );
    withEnvironment(
      {
        AQA_OIDC_ENABLED: 'true',
        AQA_OIDC_ISSUER: 'https://idp.example.test',
        AQA_OIDC_CLIENT_ID: undefined,
        AQA_OIDC_REDIRECT_URI: 'https://aqa.example.test/auth/callback',
        AQA_OIDC_CLIENT_SECRET: 'test-only-secret',
        AQA_OIDC_SESSION_DSN: undefined,
      },
      () => {
        const d = runDoctor({ root, production: true });
        const check = d.checks.find((c) => c.id === 'production-admin-auth');
        assert.equal(check?.status, 'fail');
        assert.match(check?.detail ?? '', /OIDC configuration missing/);
        assert.doesNotMatch(check?.detail ?? '', /test-only-secret/);
      },
    );
  });

  it('warns when the production evidence pack has no restore binding inputs', () => {
    const root = makeTempProject({ 'package.json': '{}' });
    withEnvironment(
      {
        AQA_PRODUCTION_EVIDENCE_PATH: undefined,
        AQA_PRODUCTION_EVIDENCE_PUBLIC_KEY_PEM: undefined,
        AQA_PRODUCTION_EVIDENCE_KEY_ID: undefined,
        AQA_PRODUCTION_DR_INVENTORY_PATH: undefined,
        AQA_PRODUCTION_DR_EVIDENCE_PATH: undefined,
      },
      () => {
        const d = runDoctor({ root, production: true });
        const binding = d.checks.find((c) => c.id === 'production-evidence-restore-binding');
        assert.equal(binding?.status, 'warn');
        assert.match(binding?.detail ?? '', /paths are not configured/);
      },
    );
  });

  it('fails production doctor when only one restore binding path is configured', () => {
    const root = makeTempProject({ 'package.json': '{}' });
    withEnvironment(
      {
        AQA_PRODUCTION_EVIDENCE_PATH: undefined,
        AQA_PRODUCTION_EVIDENCE_PUBLIC_KEY_PEM: undefined,
        AQA_PRODUCTION_EVIDENCE_KEY_ID: undefined,
        AQA_PRODUCTION_DR_INVENTORY_PATH: 'inventory.json',
        AQA_PRODUCTION_DR_EVIDENCE_PATH: undefined,
      },
      () => {
        const d = runDoctor({ root, production: true });
        const binding = d.checks.find((c) => c.id === 'production-evidence-restore-binding');
        assert.equal(binding?.status, 'fail');
        assert.match(binding?.detail ?? '', /configured together/);
      },
    );
  });

  it('fails production doctor for unreadable restore binding inputs', () => {
    const root = makeTempProject({ 'package.json': '{}' });
    withEnvironment(
      {
        AQA_PRODUCTION_EVIDENCE_PATH: 'production-evidence.json',
        AQA_PRODUCTION_EVIDENCE_PUBLIC_KEY_PEM: '-----BEGIN PUBLIC KEY-----',
        AQA_PRODUCTION_EVIDENCE_KEY_ID: undefined,
        AQA_PRODUCTION_DR_INVENTORY_PATH: 'inventory.json',
        AQA_PRODUCTION_DR_EVIDENCE_PATH: 'restore.json',
      },
      () => {
        const d = runDoctor({ root, production: true });
        const binding = d.checks.find((c) => c.id === 'production-evidence-restore-binding');
        assert.equal(binding?.status, 'fail');
        assert.match(binding?.detail ?? '', /signed production evidence is required/);
      },
    );
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
    runInit({ root });
    const r = runValidate({ root });
    assert.equal(r.ok, true);
  });
});
