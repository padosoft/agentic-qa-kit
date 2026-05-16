#!/usr/bin/env node
// Run a script across every workspace package that defines it.
//
// - Picks `bun` if available, otherwise falls back to `npm` (Node 22 LTS tier-1 fallback).
//   The picker can be overridden by `AQA_PKG_RUNNER` (one of: `bun`, `npm`).
// - If no workspace package defines the script, exits 0 with a notice.
// - If any workspace fails, exits with the worst non-zero exit code.
// - Workspace patterns supported: `<dir>` and `<dir>/*`. Anything else (e.g.
//   `<dir>/**`, brace-expanded) prints a warning and is skipped (no silent drift).
//
// Usage: node scripts/run-workspace-script.mjs <script-name>

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const script = process.argv[2];
if (!script) {
  console.error('usage: run-workspace-script.mjs <script-name>');
  process.exit(2);
}

const root = process.cwd();
const rootPkgPath = join(root, 'package.json');
if (!existsSync(rootPkgPath)) {
  console.error(`no package.json found in ${root}`);
  process.exit(2);
}
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
let workspaces;
if (Array.isArray(rootPkg.workspaces)) {
  workspaces = rootPkg.workspaces;
} else if (rootPkg.workspaces && Array.isArray(rootPkg.workspaces.packages)) {
  workspaces = rootPkg.workspaces.packages;
} else if (rootPkg.workspaces === undefined) {
  workspaces = [];
} else {
  console.error(
    `[run-workspace-script] package.json "workspaces" field has unsupported shape; expected an array or an object with a "packages" array. Got: ${JSON.stringify(rootPkg.workspaces)}`,
  );
  process.exit(2);
}

if (workspaces.length === 0) {
  console.log(`[run-workspace-script] no workspaces declared — nothing to run for "${script}".`);
  process.exit(0);
}

/** Pick the package runner. Prefers explicit env override; otherwise bun > npm. */
function pickRunner() {
  const override = process.env.AQA_PKG_RUNNER;
  if (override) {
    if (override !== 'bun' && override !== 'npm') {
      console.error(`AQA_PKG_RUNNER must be "bun" or "npm" (got "${override}")`);
      process.exit(2);
    }
    return override;
  }
  // `where`/`which` style probe.
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['bun'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return probe.status === 0 ? 'bun' : 'npm';
}

const runner = pickRunner();
const runArgs = runner === 'bun' ? ['run', script] : ['run', '--silent', script];

function loadPkg(pkgPath) {
  return JSON.parse(readFileSync(pkgPath, 'utf8'));
}

const matched = [];
for (const pattern of workspaces) {
  // Only support simple "<dir>" or "<dir>/*"; anything more advanced needs a real glob lib.
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    const baseAbs = join(root, base);
    if (!existsSync(baseAbs)) continue;
    for (const entry of readdirSync(baseAbs)) {
      const entryPath = join(baseAbs, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      const pkgPath = join(entryPath, 'package.json');
      if (existsSync(pkgPath)) {
        matched.push({ dir: entryPath, pkgPath, pkg: loadPkg(pkgPath) });
      }
    }
  } else if (!pattern.includes('*') && !pattern.includes('{')) {
    const dirAbs = join(root, pattern);
    const pkgPath = join(dirAbs, 'package.json');
    if (existsSync(pkgPath)) {
      matched.push({ dir: dirAbs, pkgPath, pkg: loadPkg(pkgPath) });
    }
  } else {
    console.warn(
      `[run-workspace-script] WARN: workspace pattern "${pattern}" uses syntax not supported by this minimal runner (only "<dir>" and "<dir>/*"). Skipped — packages under it will NOT run "${script}". Either change the pattern or replace this script with a real glob (e.g. fast-glob/tinyglobby).`,
    );
  }
}

const haveScript = matched.filter(
  ({ pkg }) => pkg.scripts && typeof pkg.scripts[script] === 'string',
);

if (haveScript.length === 0) {
  console.log(
    `[run-workspace-script] no workspace package defines "${script}" yet — nothing to do.`,
  );
  process.exit(0);
}

let worst = 0;
for (const { dir, pkg } of haveScript) {
  console.log(`[run-workspace-script] (${pkg.name ?? dir}) ${runner} ${runArgs.join(' ')}`);
  const r = spawnSync(runner, runArgs, {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    worst = Math.max(worst, r.status ?? 1);
  }
}

process.exit(worst);
