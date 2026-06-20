// Shared helper: pick the package runner (bun or npm).
// Returns one of: { runner: 'bun', exec: 'bunx' } or { runner: 'npm', exec: 'npx' }.
// - Respects AQA_PKG_RUNNER env override (one of: bun, npm; trimmed, lowercased).
// - Otherwise probes for the canonical `bun` binary on PATH; falls back to npm.

import { spawnSync } from 'node:child_process';
import { constants as osConstants } from 'node:os';

const IS_WIN = process.platform === 'win32';

/** POSIX 128 + signo, using Node's full signal map. */
export function signalToExit(signal) {
  const signo = osConstants.signals?.[signal];
  return typeof signo === 'number' ? 128 + signo : 1;
}

export function pickRunner() {
  const raw = process.env.AQA_PKG_RUNNER;
  if (raw !== undefined) {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'bun') return { runner: 'bun', exec: 'bunx' };
    if (normalized === 'npm') return { runner: 'npm', exec: 'npx' };
    console.error(`AQA_PKG_RUNNER must be "bun" or "npm" (got "${raw}")`);
    process.exit(2);
  }
  const probe = spawnSync(IS_WIN ? 'where' : 'which', ['bun'], {
    stdio: 'ignore',
    shell: IS_WIN,
  });
  return probe.status === 0 ? { runner: 'bun', exec: 'bunx' } : { runner: 'npm', exec: 'npx' };
}

export const SHELL_FOR_NATIVE = IS_WIN;
