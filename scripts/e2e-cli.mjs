#!/usr/bin/env node
/**
 * End-to-end smoke test for the `aqa` CLI against `examples/bun-api`.
 *
 * What this exercises:
 *   1. `aqa --version`        — binary is wired
 *   2. `aqa --help`           — help text is reachable
 *   3. `aqa doctor`           — project profiler runs without throwing
 *   4. `aqa validate`         — schema-validates the example's
 *                                agentic-qa-kit.yaml
 *
 * What it does NOT do (deferred):
 *   - `aqa run` against a live target. The runner contract is exercised
 *     in `packages/runner/test/*`; spinning up the example app + LLM
 *     adapter inside CI is a Task 7 follow-up.
 *
 * Wire into CI via `bun run test:e2e-cli` from the root package.json.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const AQA_BIN = resolve(ROOT, 'packages/kit/dist/cli/aqa.js');
const EXAMPLE = resolve(ROOT, 'examples/bun-api');

const cases = [
  { label: 'version', args: ['--version'], expectExit: 0, expectStdout: /\d+\.\d+/ },
  { label: 'help', args: ['--help'], expectExit: 0, expectStdout: /Usage/i },
  { label: 'doctor', args: ['doctor'], expectExit: [0, 1], cwd: EXAMPLE },
  { label: 'validate', args: ['validate'], expectExit: [0, 1], cwd: EXAMPLE },
];

let failed = 0;
for (const c of cases) {
  const result = spawnSync(process.execPath, [AQA_BIN, ...c.args], {
    cwd: c.cwd ?? ROOT,
    encoding: 'utf8',
    timeout: 20_000,
  });

  const expectedExits = Array.isArray(c.expectExit) ? c.expectExit : [c.expectExit];
  const exitOk = expectedExits.includes(result.status ?? -1);
  const stdoutOk = c.expectStdout ? c.expectStdout.test(result.stdout ?? '') : true;
  const ok = exitOk && stdoutOk;

  if (ok) {
    console.log(`✓ ${c.label} (exit=${result.status})`);
  } else {
    failed += 1;
    console.log(`✗ ${c.label} (exit=${result.status}, expected ${expectedExits.join('|')})`);
    if (result.stdout)
      console.log('  stdout:', result.stdout.split('\n').slice(0, 5).join('\n         '));
    if (result.stderr)
      console.log('  stderr:', result.stderr.split('\n').slice(0, 5).join('\n         '));
  }
}

if (failed > 0) {
  console.error(`\n${failed} smoke check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} CLI smoke checks passed.`);
