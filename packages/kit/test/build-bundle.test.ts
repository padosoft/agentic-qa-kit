/**
 * v1.9 — bundling + publish-prep smoke.
 *
 * Verifies the two scripts the publish workflow depends on:
 *   - scripts/build-bundle.mjs emits dist/cli.cjs (CJS, executable, non-empty).
 *   - scripts/publish-prep.mjs rewrites name, strips @aqa/* deps, pins
 *     remaining workspace:* deps.
 *
 * Bundle assertions only run if the bundle has already been built (the
 * test isn't a `bun run build` invocation — that would be circular,
 * since `pretest` runs tsc but NOT the bundler). On a fresh checkout
 * the bundle assertions skip; the publish-prep tests always run.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kitRoot = resolve(here, '..');
const bundlePath = join(kitRoot, 'dist', 'cli.cjs');
const metaPath = join(kitRoot, 'dist', 'cli.bundle.meta.json');

describe('build-bundle — dist/cli.cjs (skipped if not built)', () => {
  it('emits a non-empty, executable bundle with a shebang', () => {
    if (!existsSync(bundlePath)) {
      console.warn(
        `[build-bundle.test] ${bundlePath} not built — skipping bundle assertions. Run \`bun run build\` first.`,
      );
      return;
    }
    const st = statSync(bundlePath);
    assert.ok(st.size > 1024, `bundle suspiciously small: ${st.size} bytes`);
    // Bundle for a CLI with 18+ workspace deps + zod + yaml + kleur is
    // ~hundreds of KB at minimum. 10 MB is a sanity ceiling — anything
    // larger probably means a workspace dist accidentally got inlined
    // as a string asset (e.g. the admin SPA HTML/JS).
    assert.ok(st.size < 10 * 1024 * 1024, `bundle too large: ${st.size} bytes (>10 MB)`);

    const head = readFileSync(bundlePath, 'utf8').slice(0, 100);
    assert.ok(
      head.startsWith('#!/usr/bin/env node'),
      `bundle must start with shebang, got: ${head.slice(0, 40)}`,
    );

    // POSIX: build-bundle.mjs chmod's the output 0o755 so consumers
    // can spawn the bin script without an extra chmod step. Windows
    // file modes don't carry POSIX execute bits the same way, so this
    // assertion is POSIX-only.
    if (process.platform !== 'win32') {
      assert.ok(
        (st.mode & 0o111) !== 0,
        `bundle must be executable (mode 755+); got mode ${(st.mode & 0o777).toString(8)}`,
      );
    }
  });

  it('emits a sidecar meta JSON (cli.bundle.meta.json)', () => {
    if (!existsSync(metaPath)) {
      console.warn(`[build-bundle.test] ${metaPath} not built — skipping meta assertions.`);
      return;
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      bytes: number;
      generated_at: string;
    };
    assert.equal(typeof meta.bytes, 'number');
    assert.ok(meta.bytes > 0);
    assert.match(meta.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('publish-prep — package.json rewrite', () => {
  // Build a fresh pkg-like object in-memory and run the rewrite logic
  // against it. The real script writes back to disk; we copy the input
  // to a temp dir, point the script at it via cwd, then assert the
  // result. This keeps the test hermetic — never modifies the real
  // packages/kit/package.json even if assertions fail mid-run.
  it('substitutes name, strips @aqa/* deps, pins remaining workspace:* deps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aqa-publish-prep-'));
    const fakePkg = {
      name: '@aqa/kit',
      version: '1.9.0',
      dependencies: {
        '@aqa/runner': 'workspace:*',
        '@aqa/schemas': 'workspace:*',
        'some-third-party-workspace': 'workspace:^1.0.0',
        yaml: '^2.6.0',
      },
      devDependencies: {
        esbuild: '^0.24.0',
      },
      aqa: { publishName: '@padosoft/agentic-qa-kit' },
    };
    // Mimic the script's directory layout: scripts/publish-prep.mjs
    // lives at <kitRoot>/scripts/, so the script resolves package.json
    // as `resolve(here, '..', 'package.json')`. Reproduce that here.
    const scriptsDir = join(dir, 'scripts');
    const fakeScript = join(scriptsDir, 'publish-prep.mjs');
    const pkgPath = join(dir, 'package.json');
    const realScript = readFileSync(join(kitRoot, 'scripts', 'publish-prep.mjs'), 'utf8');
    // Materialise the temp tree and run.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(pkgPath, `${JSON.stringify(fakePkg, null, 2)}\n`, 'utf8');
    writeFileSync(fakeScript, realScript, 'utf8');

    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [fakeScript], { encoding: 'utf8' });
    assert.equal(
      r.status,
      0,
      `publish-prep exited ${r.status}\nstdout:${r.stdout}\nstderr:${r.stderr}`,
    );

    const rewritten = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    assert.equal(rewritten.name, '@padosoft/agentic-qa-kit');
    // @aqa/* must be GONE entirely — they're bundled into dist/cli.cjs
    // and don't exist on any registry, so leaving them would make `bun
    // add @padosoft/agentic-qa-kit` fail with "404 — @aqa/runner not
    // found on registry" (Copilot iter 1 P1 on PR #55).
    assert.equal(
      rewritten.dependencies['@aqa/runner'],
      undefined,
      '@aqa/* deps must be stripped (they are bundled, not published)',
    );
    assert.equal(rewritten.dependencies['@aqa/schemas'], undefined);
    // Non-@aqa workspace:* deps still get pinned to the kit version
    // (kept in case the kit ever depends on a non-aqa workspace).
    assert.equal(
      rewritten.dependencies['some-third-party-workspace'],
      '1.9.0',
      'non-@aqa workspace:* must be pinned to the kit version',
    );
    assert.equal(rewritten.dependencies.yaml, '^2.6.0', 'non-workspace deps must be left alone');
  });

  it('exits non-zero when aqa.publishName is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aqa-publish-prep-'));
    const pkgPath = join(dir, 'package.json');
    writeFileSync(
      pkgPath,
      `${JSON.stringify({ name: '@aqa/kit', version: '1.9.0' }, null, 2)}\n`,
      'utf8',
    );
    const scriptsDir = join(dir, 'scripts');
    const fakeScript = join(scriptsDir, 'publish-prep.mjs');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      fakeScript,
      readFileSync(join(kitRoot, 'scripts', 'publish-prep.mjs'), 'utf8'),
      'utf8',
    );
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [fakeScript], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'publish-prep must fail when publishName is missing');
    assert.match(r.stderr ?? '', /publishName/);
  });
});
