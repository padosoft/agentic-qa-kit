#!/usr/bin/env node
// Run a packaged tool via bunx if available, else npx.
// Honors AQA_PKG_RUNNER=bun|npm to force a choice.
//
// Usage: node scripts/run-tool.mjs <tool> [args...]

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: run-tool.mjs <tool> [args...]');
  process.exit(2);
}

function pickRunner() {
  const override = process.env.AQA_PKG_RUNNER;
  if (override === 'bun') return 'bunx';
  if (override === 'npm') return 'npx';
  if (override) {
    console.error(`AQA_PKG_RUNNER must be "bun" or "npm" (got "${override}")`);
    process.exit(2);
  }
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['bunx'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return probe.status === 0 ? 'bunx' : 'npx';
}

const runner = pickRunner();
console.log(`[run-tool] ${runner} ${args.join(' ')}`);
const r = spawnSync(runner, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
