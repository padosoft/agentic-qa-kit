import { spawnSync } from 'node:child_process';
// Diagnostic reproductions for the review, not a passing regression suite.
// From repository root: bun run build:workspace; node docs/internal/reviews/2026-09-17-reproduce.mjs
// Uses synthetic data, loopback HTTP and temporary directories. No external SUT or LLM calls.
// Temporary fixture directories are retained for inspection. No production files are edited.
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require = createRequire(new URL('../../../packages/kit/package.json', import.meta.url));
const yaml = require('yaml');
const { parse } = yaml;
import { createServer } from 'node:http';
import { verifyEventChain } from '../../../packages/compliance/dist/index.js';
import { runAdmin } from '../../../packages/kit/dist/commands/admin.js';
import { runInit } from '../../../packages/kit/dist/commands/init.js';
import { runReport } from '../../../packages/kit/dist/commands/report.js';
import { runRun } from '../../../packages/kit/dist/commands/run.js';
import { runPackNew } from '../../../packages/pack-author/dist/index.js';
import {
  EventChainWriter,
  makeHttpProbeRunner,
  runScenario,
  verifyScenario,
} from '../../../packages/runner/dist/index.js';
import { Finding, Scenario } from '../../../packages/schemas/dist/index.js';
import { RunnerQueue, makeApi } from '../../../packages/server/dist/index.js';
import { MemoryStore } from '../../../packages/store/dist/index.js';

const show = (id, evidence) => console.log(JSON.stringify({ id, ...evidence }));
const root = mkdtempSync(join(tmpdir(), 'aqa-review-'));
show('environment', { root, runtime: process.version });
const idempotency = Scenario.Scenario.parse(
  parse(readFileSync('packs/api-core/scenarios/idempotency.yaml', 'utf8')),
);
let serial = 0;
const dup = await runScenario({
  scenario: idempotency,
  run_id: 'run-review',
  probeRunner: async (p) => ({ probe_id: p.id, status: 201, body: { id: ++serial } }),
});
show('idempotency-false-pass', {
  differentIds: dup.probes.map((p) => p.body.id),
  passed: dup.oracles[0].passed,
  finding: dup.finding,
});
const scenario = Scenario.Scenario.parse({
  schema_version: '1',
  id: 'scn-review',
  title: 'Review synthetic scenario',
  risk_refs: ['r-review'],
  steps: [{ id: 'p-one', kind: 'http', with: { url: '/health' } }],
  oracles: [{ id: 'o-one', kind: 'http_status', with: { expected: 200 } }],
  cleanup: [{ id: 'p-clean', kind: 'http', with: { url: '/cleanup' } }],
});
const stub = await runScenario({ scenario, run_id: 'run-stub' });
show('no-driver-false-pass', { status: stub.probes[0].status, passed: stub.oracles[0].passed });
const agentPack = Scenario.Scenario.parse(
  parse(readFileSync('packs/llm-agent/scenarios/prompt-injection.yaml', 'utf8')),
);
const agentResult = await runScenario({ scenario: agentPack, run_id: 'run-agent-pack' });
show('shipped-agent-pack-false-pass', {
  passed: agentResult.oracles[0].passed,
  probeStatus: agentResult.probes[0].status,
});
const receivedAuth = [];
const sut = createServer((req, res) => {
  receivedAuth.push(Boolean(req.headers.authorization));
  res.statusCode = req.url === '/auth/rotate' ? 200 : 401;
  res.end('{}');
});
await new Promise((resolve) => sut.listen(0, '127.0.0.1', resolve));
try {
  const tokenScenario = Scenario.Scenario.parse(
    parse(readFileSync('packs/api-core/scenarios/auth-token-replay.yaml', 'utf8')),
  );
  const tokenResult = await runScenario({
    scenario: tokenScenario,
    run_id: 'run-token',
    probeRunner: makeHttpProbeRunner({ baseUrl: `http://127.0.0.1:${sut.address().port}` }),
  });
  show('token-test-no-token', {
    passed: tokenResult.oracles[0].passed,
    requestsAuthenticated: receivedAuth,
  });
} finally {
  await new Promise((resolve) => sut.close(resolve));
}
const neg = {
  ...scenario,
  oracles: [
    { id: 'o-neg', kind: 'response_not_contains', with: { value: 'private-data' }, weight: 1 },
  ],
};
const down = await runScenario({
  scenario: neg,
  run_id: 'run-down',
  probeRunner: async (p) => ({ probe_id: p.id, error: 'synthetic transport unavailable' }),
});
show('transport-false-pass', {
  probeError: down.probes[0].error,
  passed: down.oracles[0].passed,
  finding: down.finding,
});
let cleanupCalls = 0;
await runScenario({
  scenario,
  run_id: 'run-clean',
  probeRunner: async (p) => {
    cleanupCalls++;
    return { probe_id: p.id, status: 200 };
  },
});
show('cleanup-not-run', { calls: cleanupCalls, expected: 2 });
let attempt = 0;
const differentFailures = {
  ...scenario,
  oracles: [
    ...scenario.oracles,
    { id: 'o-body', kind: 'response_contains', with: { value: 'expected-body' }, weight: 1 },
  ],
};
const replay = await verifyScenario({
  scenario: differentFailures,
  run_id: 'run-verify',
  attempts: 2,
  probeRunner: async (p) => ({
    probe_id: p.id,
    status: ++attempt === 1 ? 500 : 200,
    body: attempt === 1 ? 'expected-body' : 'different-body',
  }),
});
show('different-failures-deterministic', {
  deterministic: replay.deterministic,
  successes: replay.successes,
});
const findings = [];
for (const run_id of ['run-first', 'run-second'])
  findings.push(
    (
      await runScenario({
        scenario,
        run_id,
        findingIdSeed: 1,
        probeRunner: async (p) => ({ probe_id: p.id, status: 500 }),
      })
    ).finding,
  );
const store = new MemoryStore();
for (const f of findings) await store.appendFinding(f);
show('finding-id-uniqueness', {
  input: findings.length,
  ids: findings.map((f) => f.id),
  stored: (await store.listFindings({})).length,
  preserved: new Set(findings.map((f) => f.id)).size === findings.length,
});
const ctx = {
  store,
  queue: new RunnerQueue(),
  authenticate: async () => ({
    id: 'review-user',
    email: 'review@example.invalid',
    roles: ['developer'],
  }),
};
const api = makeApi();
const foreign = await api
  .find((r) => r.method === 'GET' && r.path === '/api/findings')
  .handle({ headers: { 'x-aqa-org': 'other', 'x-aqa-project': 'unrelated' }, params: {} }, ctx);
show('unscoped-findings', { status: foreign.status, count: foreign.body.findings.length });
const changed = await api
  .find((r) => r.method === 'POST' && r.path === '/api/findings/:id/status')
  .handle(
    {
      headers: {},
      params: { id: findings[1].id },
      body: { status: 'verified', reason: 'synthetic review check' },
    },
    ctx,
  );
show('verified-invariant-bypass', {
  status: changed.status,
  accepted: changed.status === 200,
  acceptedState: changed.body?.finding?.status ?? null,
  schemaValid: changed.body?.finding
    ? Finding.Finding.safeParse(changed.body.finding).success
    : false,
  auditEvents: (await store.listAuditEvents({})).length,
});
const writer = new EventChainWriter('unused', { persist: false });
writer.append({
  ts: new Date().toISOString(),
  run_id: 'run-audit',
  kind: 'run_started',
  actor: { type: 'system', id: 'review' },
  payload: { project: 'original' },
});
const chain = JSON.parse(JSON.stringify(writer.snapshot()));
chain[0].payload.project = 'changed-without-rehash';
show('audit-verifier-backend', {
  backendAcceptsTamper: verifyEventChain(chain).ok,
  note: 'Browser UI verification is asserted by built-ui-real-api-tamper below',
});
runInit({ root, projectName: 'review-app' });
runPackNew({ root, slug: 'review-pack', sutType: 'lib' });
// Use generated fixture files. Scaffolder supplies an expected-200 scenario.
const fs = await import('node:fs');
const profilesPath = join(root, '.aqa', 'profiles.yaml');
const profiles = parse(readFileSync(profilesPath, 'utf8'));
for (const p of Object.values(profiles.profiles)) p.packs = ['review-pack'];
fs.writeFileSync(profilesPath, yaml.stringify(profiles));
const pack = parse(readFileSync(join(root, 'packs', 'review-pack', 'pack.yaml'), 'utf8'));
const actualScenario = join(root, 'packs', 'review-pack', pack.scenarios[0]);
const scn = parse(readFileSync(actualScenario, 'utf8'));
scn.oracles = [{ id: 'o-review', kind: 'http_status', with: { expected: 401 } }];
fs.writeFileSync(actualScenario, yaml.stringify(scn));
const run = await runRun({ root, profile: 'release-gate' });
const report = runReport({ root, runId: run.runId });
const rendered = JSON.parse(readFileSync(join(run.runDir, 'report.json'), 'utf8'));
show('failed-run-success-report', {
  runOk: run.ok,
  runError: run.error,
  reportOk: report.ok,
  reportState: rendered.run.state,
  artifacts: readdirSync(run.runDir),
});
scn.oracles[0].with.expected = 200;
fs.writeFileSync(actualScenario, yaml.stringify(scn));
const emptyGate = await runRun({ root, profile: 'release-gate' });
show('release-gate-no-network', {
  ok: emptyGate.ok,
  findings: emptyGate.findingsCount,
  scenarios: emptyGate.scenariosRun,
});
for (const verb of ['run', 'admin']) {
  const result = spawnSync(
    'node',
    [resolve('packages/kit/dist/cli.cjs'), verb, ...(verb === 'run' ? ['--profile', 'smoke'] : [])],
    { cwd: root, encoding: 'utf8', timeout: 10000 },
  );
  show(`bundle-${verb}`, { exit: result.status, stderr: result.stderr.trim().slice(0, 550) });
}
const admin = await runAdmin({ root, port: 0, adminDistDir: resolve('packages/admin/dist') });
if (admin.ok) {
  try {
    const hdr = { 'content-type': 'application/json', origin: 'https://untrusted.example.invalid' };
    const response = await fetch(`${admin.url}/api/orgs`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify({ schema_version: '1', slug: 'review-org', name: 'Synthetic review' }),
    });
    show('unauthenticated-admin-write', {
      status: response.status,
      cors: response.headers.get('access-control-allow-origin'),
    });
    const runs = await fetch(`${admin.url}/api/runs`, {
      headers: { 'x-aqa-org': 'review-org', 'x-aqa-project': 'review-app' },
    }).then((r) => r.json());
    show('failed-run-success-admin', { states: runs.runs.map((r) => r.state) });
  } finally {
    await admin.close();
  }
}
const queue = new RunnerQueue({ lease_ms: 10 });
queue.enqueue({ id: 'review-job', payload: {}, enqueued_at: new Date(0).toISOString() });
queue.dequeue(new Date(0));
queue.dequeue(new Date(20));
show('stale-worker-ack', { accepted: queue.ack('review-job'), state: queue.snapshot()[0].status });
const restart = await runAdmin({ root, port: 0, adminDistDir: resolve('packages/admin/dist') });
if (restart.ok) {
  try {
    const orgs = await fetch(`${restart.url}/api/orgs`).then((r) => r.json());
    show('restart-loses-mutation', { orgs: orgs.orgs.length });
  } finally {
    await restart.close();
  }
}
const browserRoot = mkdtempSync(join(tmpdir(), 'aqa-review-browser-'));
const browserRuns = join(browserRoot, '.aqa', 'runs', 'run-audit');
fs.mkdirSync(browserRuns, { recursive: true });
fs.writeFileSync(
  join(browserRuns, 'events.jsonl'),
  `${chain.map((e) => JSON.stringify(e)).join('\n')}\n`,
);
fs.writeFileSync(join(browserRuns, 'findings.jsonl'), '');
const browserAdmin = await runAdmin({
  root: browserRoot,
  port: 0,
  adminDistDir: resolve('packages/admin/dist'),
});
if (browserAdmin.ok) {
  let browser;
  try {
    const pwRequire = createRequire(
      new URL('../../../packages/admin/package.json', import.meta.url),
    );
    const { chromium } = pwRequire('@playwright/test');
    browser = await chromium.launch({ headless: true, timeout: 15000 });
    const page = await browser.newPage();
    const requests = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) requests.push(new URL(r.url()).pathname);
    });
    await page.goto(browserAdmin.url);
    await page.locator('.nav-item').filter({ hasText: /^Runs/ }).first().click();
    await page.waitForTimeout(400);
    show('built-ui-runs', { readRunsApi: requests.includes('/api/runs') });
    await page
      .locator('.nav-item')
      .filter({ hasText: /^Audit log/ })
      .first()
      .click();
    await page.getByText(/1 events.*live from/).waitFor({ timeout: 10000 });
    await page
      .getByRole('button', { name: /^Verify( chain)?$/i })
      .first()
      .click();
    await page.getByRole('heading', { name: 'CHAIN BROKEN' }).waitFor({ timeout: 10000 });
    show('built-ui-real-api-tamper', {
      chainOk: false,
      backendVerifierAccepts: false,
      mockedRequests: 0,
    });
  } catch (e) {
    show('browser-limitation', { error: e.message.slice(0, 650) });
  } finally {
    if (browser) await browser.close();
    await browserAdmin.close();
  }
}
