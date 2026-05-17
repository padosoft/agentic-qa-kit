#!/usr/bin/env node
// Run a script across every workspace package that defines it.
//
// - Picks `bun` if available, otherwise falls back to `npm` (Node 22 LTS tier-1 fallback).
//   The picker can be overridden by `AQA_PKG_RUNNER` (one of: `bun`, `npm`).
// - If no workspace package defines the script, exits 0 with a notice.
// - If any workspace fails, exits with the worst non-zero exit code; on signal
//   termination, exits with 128 + signo and stops dispatching further work.
// - On spawnSync launch failure (e.g. ENOENT for the runner) prints the underlying
//   error message before exiting 1.
// - Workspace patterns supported: `<dir>`, `<dir>/*`, and bare `*`. Anything else
//   (e.g. `<dir>/**`, brace-expanded, `foo*`, `?`, `[ab]`) is detected and warned;
//   `!path` negations are refused with exit 2 because silently skipping them produces
//   wrong execution lists.
// - Bare `*` excludes well-known non-workspace dirs (node_modules, dist, build,
//   coverage, .git, .aqa, .cache, dotfiles) to mirror tsconfig/biome ignore lists.
// - Workspace iteration order is deterministic (alphabetical absolute path) for
//   reproducible logs across platforms.
//
// Usage: node scripts/run-workspace-script.mjs <script-name>

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SHELL_FOR_NATIVE, pickRunner, signalToExit } from './_pick-runner.mjs';

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

// Validate each workspace entry is a string up front, so any later glob check fails
// with a clear diagnostic instead of a generic `pattern.startsWith is not a function`.
for (let i = 0; i < workspaces.length; i++) {
  if (typeof workspaces[i] !== 'string') {
    console.error(
      `[run-workspace-script] workspaces[${i}] is not a string: ${JSON.stringify(workspaces[i])}. Each workspaces entry must be a glob pattern string.`,
    );
    process.exit(2);
  }
}

// Negation patterns (`!path`) have semantic meaning in workspaces (exclude entries
// matched by earlier patterns). This minimal runner does not support them — silently
// skipping would produce wrong execution lists. Fail fast instead.
for (const pattern of workspaces) {
  if (pattern.startsWith('!')) {
    console.error(
      `[run-workspace-script] negation workspace pattern "${pattern}" is not supported by this minimal runner. Workspaces like ["packages/*", "!packages/legacy"] would silently include "legacy" — refusing to proceed. Either drop the negation or replace this script with a real glob (e.g. fast-glob/tinyglobby).`,
    );
    process.exit(2);
  }
}

const GLOB_CHARS = /[*?[\]{}!]/;
const BARE_STAR_EXCLUDE = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.aqa',
  '.cache',
  '.next',
  '.nuxt',
  'playwright-report',
  'test-results',
]);

const { runner, exec: _exec } = pickRunner();
const runArgs = [runner === 'bun' ? 'run' : 'run', '--silent', script];

function loadPkg(pkgPath) {
  return JSON.parse(readFileSync(pkgPath, 'utf8'));
}

function safeStat(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

function collectPackagesUnder(baseAbs, { excludeBareStar = false } = {}) {
  /** @type {Array<{dir:string, pkgPath:string, pkg:any}>} */
  const out = [];
  if (!existsSync(baseAbs)) return out;
  const st = safeStat(baseAbs);
  if (!st || !st.isDirectory()) return out;
  for (const entry of readdirSync(baseAbs)) {
    if (excludeBareStar && (entry.startsWith('.') || BARE_STAR_EXCLUDE.has(entry))) continue;
    const entryPath = join(baseAbs, entry);
    const entryStat = safeStat(entryPath);
    if (!entryStat || !entryStat.isDirectory()) continue;
    const pkgPath = join(entryPath, 'package.json');
    if (existsSync(pkgPath)) {
      out.push({ dir: entryPath, pkgPath, pkg: loadPkg(pkgPath) });
    }
  }
  return out;
}

const matched = [];
const seenDirs = new Set();
function tryAdd(entry) {
  if (seenDirs.has(entry.dir)) return;
  seenDirs.add(entry.dir);
  matched.push(entry);
}

for (const pattern of workspaces) {
  // Supported: "<dir>", "<dir>/*", and bare "*".
  if (pattern === '*') {
    for (const e of collectPackagesUnder(root, { excludeBareStar: true })) tryAdd(e);
  } else if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    for (const e of collectPackagesUnder(join(root, base))) tryAdd(e);
  } else if (!GLOB_CHARS.test(pattern)) {
    const dirAbs = join(root, pattern);
    const pkgPath = join(dirAbs, 'package.json');
    if (existsSync(pkgPath)) {
      tryAdd({ dir: dirAbs, pkgPath, pkg: loadPkg(pkgPath) });
    }
  } else {
    console.warn(
      `[run-workspace-script] WARN: workspace pattern "${pattern}" uses syntax not supported by this minimal runner (supported: "<dir>", "<dir>/*", and bare "*"). Skipped — packages under it will NOT run "${script}". Either change the pattern or replace this script with a real glob (e.g. fast-glob/tinyglobby).`,
    );
  }
}

// Deterministic order (alphabetical absolute dir) so CI logs are reproducible.
matched.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));

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
    shell: SHELL_FOR_NATIVE,
  });
  if (r.error) {
    console.error(`[run-workspace-script] failed to launch "${runner}": ${r.error.message}`);
    process.exit(1);
  }
  if (r.signal) {
    console.error(`[run-workspace-script] child terminated by signal ${r.signal}; aborting loop.`);
    process.exit(signalToExit(r.signal));
  }
  if (r.status !== 0) {
    worst = Math.max(worst, r.status ?? 1);
  }
}

process.exit(worst);
