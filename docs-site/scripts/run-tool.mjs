#!/usr/bin/env node
// Run a packaged tool via bunx if available, else npx.
// Honors AQA_PKG_RUNNER=bun|npm to force a choice.
//
// Exits with the tool's exit code; on signal termination, exits with 128 + signo
// (POSIX convention). On spawnSync launch failure (e.g. ENOENT, EACCES) prints
// the underlying error message before exiting 1.
//
// Usage: node scripts/run-tool.mjs <tool> [args...]

import { spawnSync } from 'node:child_process';
import { SHELL_FOR_NATIVE, pickRunner, signalToExit } from './_pick-runner.mjs';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: run-tool.mjs <tool> [args...]');
  process.exit(2);
}

const { exec } = pickRunner();
console.log(`[run-tool] ${exec} ${args.join(' ')}`);
const r = spawnSync(exec, args, {
  stdio: 'inherit',
  shell: SHELL_FOR_NATIVE,
});
if (r.error) {
  console.error(`[run-tool] failed to launch "${exec}": ${r.error.message}`);
  process.exit(1);
}
if (r.signal) {
  console.error(`[run-tool] child terminated by signal ${r.signal}`);
  process.exit(signalToExit(r.signal));
}
process.exit(r.status ?? 1);
