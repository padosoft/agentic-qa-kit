#!/usr/bin/env node
// Run a script across every workspace package that defines it.
//
// - Picks `bun` if available, otherwise falls back to `npm` (Node 22 LTS tier-1 fallback).
//   The picker can be overridden by `AQA_PKG_RUNNER` (one of: `bun`, `npm`).
// - If no workspace package defines the script, exits 0 with a notice.
// - If any workspace fails, exits with the worst non-zero exit code; on signal
//   termination, exits with 128 + signo and stops dispatching further work.
// - Workspace patterns supported: `<dir>`, `<dir>/*`, and bare `*`. Anything else
//   (e.g. `<dir>/**`, brace-expanded, `foo*`) prints a warning and is skipped.
//
// Usage: node scripts/run-workspace-script.mjs <script-name>

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { join } from 'node:path';

const SIGNAL_TO_EXIT = (signal) => {
  // POSIX convention: 128 + signal number. `os.constants.signals` covers any signal
  // Node knows about (SIGKILL=9 → 137, SIGSEGV=11 → 139, SIGABRT=6 → 134, SIGPIPE=13
  // → 141, etc.). Falls back to 1 if Node has no number for the name.
  const signo = osConstants.signals?.[signal];
  return typeof signo === 'number' ? 128 + signo : 1;
};

const IS_WIN = process.platform === 'win32';
const SHELL_FOR_NATIVE = IS_WIN; // Windows needs shell:true for .cmd / .ps1 shims.

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
  const raw = process.env.AQA_PKG_RUNNER;
  if (raw !== undefined) {
    const normalized = raw.trim().toLowerCase();
    if (normalized !== 'bun' && normalized !== 'npm') {
      console.error(`AQA_PKG_RUNNER must be "bun" or "npm" (got "${raw}")`);
      process.exit(2);
    }
    return normalized;
  }
  const probe = spawnSync(IS_WIN ? 'where' : 'which', ['bun'], {
    stdio: 'ignore',
    shell: SHELL_FOR_NATIVE,
  });
  return probe.status === 0 ? 'bun' : 'npm';
}

const runner = pickRunner();
const runArgs = runner === 'bun' ? ['run', script] : ['run', '--silent', script];

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

function collectPackagesUnder(baseAbs) {
  /** @type {Array<{dir:string, pkgPath:string, pkg:any}>} */
  const out = [];
  if (!existsSync(baseAbs)) return out;
  const st = safeStat(baseAbs);
  if (!st || !st.isDirectory()) return out;
  for (const entry of readdirSync(baseAbs)) {
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
    for (const e of collectPackagesUnder(root)) tryAdd(e);
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
  if (r.signal) {
    console.error(`[run-workspace-script] child terminated by signal ${r.signal}; aborting loop.`);
    process.exit(SIGNAL_TO_EXIT(r.signal));
  }
  if (r.status !== 0) {
    worst = Math.max(worst, r.status ?? 1);
  }
}

process.exit(worst);
