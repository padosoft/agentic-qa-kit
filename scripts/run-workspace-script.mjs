#!/usr/bin/env node
// Run a script across every workspace package that defines it.
// If no workspace package defines the script, exits 0 with a notice.
// If any workspace fails, exits with the worst non-zero exit code.
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
const workspaces = Array.isArray(rootPkg.workspaces)
  ? rootPkg.workspaces
  : (rootPkg.workspaces?.packages ?? []);

if (workspaces.length === 0) {
  console.log(`[run-workspace-script] no workspaces declared — nothing to run for "${script}".`);
  process.exit(0);
}

const matched = [];
for (const pattern of workspaces) {
  // Only support simple "<dir>/*" or "<dir>" patterns; sufficient for our monorepo.
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    const baseAbs = join(root, base);
    if (!existsSync(baseAbs)) continue;
    for (const entry of readdirSync(baseAbs)) {
      const entryPath = join(baseAbs, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      const pkgPath = join(entryPath, 'package.json');
      if (existsSync(pkgPath)) {
        matched.push({ dir: entryPath, pkgPath });
      }
    }
  } else {
    const dirAbs = join(root, pattern);
    const pkgPath = join(dirAbs, 'package.json');
    if (existsSync(pkgPath)) {
      matched.push({ dir: dirAbs, pkgPath });
    }
  }
}

const haveScript = matched.filter(({ pkgPath }) => {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.scripts && typeof pkg.scripts[script] === 'string';
});

if (haveScript.length === 0) {
  console.log(
    `[run-workspace-script] no workspace package defines "${script}" yet — nothing to do.`,
  );
  process.exit(0);
}

let worst = 0;
for (const { dir, pkgPath } of haveScript) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  console.log(`[run-workspace-script] (${pkg.name ?? dir}) bun run ${script}`);
  const r = spawnSync('bun', ['run', script], {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    worst = Math.max(worst, r.status ?? 1);
  }
}

process.exit(worst);
