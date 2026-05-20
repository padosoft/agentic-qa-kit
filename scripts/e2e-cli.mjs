#!/usr/bin/env node
/**
 * End-to-end smoke test for the `aqa` CLI against `examples/bun-api`.
 *
 * What this exercises:
 *   1. `aqa --version`        — binary is wired
 *   2. `aqa --help`           — help text is reachable
 *   3. `aqa doctor`           — project profiler runs without throwing
 *   4. `aqa validate`         — schema-validates generated .aqa/*
 *   5. `aqa run --profile smoke` against a live local HTTP target
 *      + verifies run artifacts are written
 *
 * Wire into CI via `bun run test:e2e-cli` from the root package.json.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const AQA_BIN = resolve(ROOT, 'packages/kit/dist/cli/aqa.js');

// Initialise a fresh sandbox via `aqa init` so that `aqa validate` has the
// `.aqa/` artifacts it expects. Using a tmp dir keeps the smoke test
// hermetic — no checked-in fixture to drift out of date.
const SANDBOX = mkdtempSync(`${tmpdir()}/aqa-cli-e2e-`);

// Seed a minimal package.json so `aqa doctor`'s runtime check resolves.
writeFileSync(
  join(SANDBOX, 'package.json'),
  JSON.stringify(
    {
      name: 'aqa-cli-e2e-fixture',
      private: true,
      version: '0.0.0',
      type: 'module',
      engines: { node: '>=22' },
    },
    null,
    2,
  ),
);
const initResult = spawnSync(process.execPath, [AQA_BIN, 'init', '--silent'], {
  cwd: SANDBOX,
  encoding: 'utf8',
  timeout: 20_000,
});
if ((initResult.status ?? -1) !== 0) {
  console.error('`aqa init` failed in sandbox:');
  console.error(' stdout:', initResult.stdout);
  console.error(' stderr:', initResult.stderr);
  rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(1);
}

// Overwrite the generated project/profile files with a minimal schema-valid
// configuration tailored for this smoke run. This avoids requiring YAML
// tooling in the root devDependencies.
const projectPath = join(SANDBOX, '.aqa', 'project.yaml');
const profilesPath = join(SANDBOX, '.aqa', 'profiles.yaml');
writeFileSync(
  projectPath,
  `schema_version: "1"
name: aqa-cli-e2e-fixture
stack:
  runtime: node
  framework: smoke-fixture
  db: []
  package_manager: npm
sut:
  type: api
  base_url: http://127.0.0.1:0
tags: []
`,
  'utf8',
);
writeFileSync(
  profilesPath,
  `schema_version: "1"
profiles:
  smoke:
    schema_version: "1"
    name: smoke
    execution_mode: orchestrator
    llm_usage: []
    llm_budget_usd: null
    parallelism: 1
    require_deterministic_replay: false
    packs:
      - pack-local-smoke
    tags:
      - smoke
`,
  'utf8',
);

// Add a local smoke pack with one HTTP scenario and wire the smoke profile
// to it. This keeps the e2e deterministic and independent from bundled pack
// evolution.
const packRoot = join(SANDBOX, 'packs', 'pack-local-smoke');
mkdirSync(join(packRoot, 'scenarios'), { recursive: true });
const packManifest = `schema_version: "1"
name: pack-local-smoke
version: 0.1.0
description: local smoke fixture for e2e-cli
author: ci
license: MIT
applies_when:
  sut_type: [api]
templates: []
scenarios:
  - scenarios/smoke-noop.yaml
risks: []
oracles: []
probes: []
`;
const packScenario = `schema_version: "1"
id: scn-smoke-noop
title: local smoke GET /healthz returns 200
risk_refs: [r-smoke]
invariant_refs: [inv-smoke]
preconditions: []
steps:
  - id: probe-noop
    kind: http
    with: { method: "GET", url: "/healthz" }
oracles:
  - id: o-status-ok
    kind: http_status
    with: { expected: 200 }
tags: [smoke]
`;
writeFileSync(join(packRoot, 'pack.yaml'), packManifest, 'utf8');
writeFileSync(
  join(packRoot, 'package.json'),
  JSON.stringify({ name: 'pack-local-smoke', version: '0.0.0', private: true }, null, 2),
);
writeFileSync(join(packRoot, 'scenarios', 'smoke-noop.yaml'), packScenario, 'utf8');

const cases = [
  { label: 'version', args: ['--version'], expectExit: 0, expectStdout: /\d+\.\d+/ },
  { label: 'help', args: ['--help'], expectExit: 0, expectStdout: /Usage/i },
  { label: 'doctor', args: ['doctor'], expectExit: 0, cwd: SANDBOX },
  { label: 'validate', args: ['validate'], expectExit: 0, cwd: SANDBOX },
  {
    label: 'run-smoke',
    args: ['run', '--profile', 'smoke'],
    expectExit: 0,
    cwd: SANDBOX,
    timeout: 90_000,
  },
];

const app = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false }));
});

let failed = 0;
try {
  const boundPort = await new Promise((resolve, reject) => {
    const onError = (error) => {
      app.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      app.off('error', onError);
      const address = app.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine local server port for smoke run'));
        return;
      }
      resolve(address.port);
    };
    app.once('error', onError);
    app.once('listening', onListening);
    app.listen(0, '127.0.0.1');
  });

  writeFileSync(
    projectPath,
    `schema_version: "1"
name: aqa-cli-e2e-fixture
stack:
  runtime: node
  framework: smoke-fixture
  db: []
  package_manager: npm
sut:
  type: api
  base_url: http://127.0.0.1:${boundPort}
tags: []
`,
    'utf8',
  );

  for (const c of cases) {
    const result = spawnSync(process.execPath, [AQA_BIN, ...c.args], {
      cwd: c.cwd ?? ROOT,
      encoding: 'utf8',
      timeout: c.timeout ?? 20_000,
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
      if (result.signal) console.log(`  signal: ${result.signal} (likely timeout)`);
      if (result.stdout)
        console.log('  stdout:', result.stdout.split('\n').slice(0, 5).join('\n         '));
      if (result.stderr)
        console.log('  stderr:', result.stderr.split('\n').slice(0, 5).join('\n         '));
    }
  }

  // Verify `aqa run` produced run artifacts with a non-empty events chain.
  const runsDir = join(SANDBOX, '.aqa', 'runs');
  if (failed === 0) {
    if (!existsSync(runsDir)) {
      failed += 1;
      console.error('✗ run-smoke did not produce .aqa/runs');
    } else {
      const runIds = readdirSync(runsDir).sort();
      if (runIds.length === 0) {
        failed += 1;
        console.error('✗ run-smoke did not produce any .aqa/runs/<run-id> directory');
      } else {
        const latest = join(runsDir, runIds[runIds.length - 1]);
        const eventsPath = join(latest, 'events.jsonl');
        const findingsPath = join(latest, 'findings.jsonl');
        if (!existsSync(eventsPath)) {
          failed += 1;
          console.error('✗ run-smoke did not produce events.jsonl');
        } else {
          const eventsText = readFileSync(eventsPath, 'utf8').trim();
          if (!eventsText) {
            failed += 1;
            console.error('✗ run-smoke produced empty events.jsonl');
          }
        }
        if (!existsSync(findingsPath)) {
          failed += 1;
          console.error('✗ run-smoke did not produce findings.jsonl');
        }
      }
    }
  }
} catch (error) {
  failed += 1;
  console.error('✗ failed to execute smoke run setup');
  if (error instanceof Error) {
    console.error(`  ${error.message}`);
  } else {
    console.error(`  ${String(error)}`);
  }
} finally {
  try {
    app.close();
  } catch {
    // ignore close failures during cleanup
  }
  rmSync(SANDBOX, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} smoke check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} CLI smoke checks passed (exit 0 required).`);
