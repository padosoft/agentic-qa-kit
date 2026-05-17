#!/usr/bin/env node
// Run a packaged tool via bunx if available, else npx.
// Honors AQA_PKG_RUNNER=bun|npm to force a choice.
//
// Exits with the tool's exit code; on signal termination, exits with 128 + signo
// (POSIX convention).
//
// Usage: node scripts/run-tool.mjs <tool> [args...]

import { spawnSync } from 'node:child_process';

const SIGNAL_TO_EXIT = (signal) => {
  const map = { SIGHUP: 129, SIGINT: 130, SIGQUIT: 131, SIGTERM: 143 };
  return map[signal] ?? 1;
};
const IS_WIN = process.platform === 'win32';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: run-tool.mjs <tool> [args...]');
  process.exit(2);
}

// Probe the canonical `bun` binary (same as scripts/run-workspace-script.mjs), then
// derive the executor name. A system can have `bun` without `bunx` or vice versa on
// custom installs; agreeing on the canonical binary keeps the two scripts in sync.
function pickRunner() {
  const raw = process.env.AQA_PKG_RUNNER;
  if (raw !== undefined) {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'bun') return 'bunx';
    if (normalized === 'npm') return 'npx';
    console.error(`AQA_PKG_RUNNER must be "bun" or "npm" (got "${raw}")`);
    process.exit(2);
  }
  const probe = spawnSync(IS_WIN ? 'where' : 'which', ['bun'], {
    stdio: 'ignore',
    shell: IS_WIN,
  });
  return probe.status === 0 ? 'bunx' : 'npx';
}

const runner = pickRunner();
console.log(`[run-tool] ${runner} ${args.join(' ')}`);
const r = spawnSync(runner, args, {
  stdio: 'inherit',
  shell: IS_WIN,
});
if (r.signal) {
  console.error(`[run-tool] child terminated by signal ${r.signal}`);
  process.exit(SIGNAL_TO_EXIT(r.signal));
}
process.exit(r.status ?? 1);
