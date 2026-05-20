#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
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
const EXAMPLE_SRC = join(ROOT, 'examples', 'bun-api');
const SANDBOX = mkdtempSync(join(tmpdir(), 'aqa-ecosystem-e2e-'));
const FIXTURE = join(SANDBOX, 'bun-api');
const API_PORT = 7777;
const SUT_PORT = 3901;
const ADMIN_PORT = 5173;
let shutdownStarted = false;

const AQA_BIN = join(ROOT, 'packages', 'kit', 'dist', 'cli', 'aqa.js');
if (!existsSync(AQA_BIN)) {
  console.error('missing packages/kit/dist/cli/aqa.js — run `bun run build` first');
  process.exit(1);
}

cpSync(EXAMPLE_SRC, FIXTURE, { recursive: true });

function mustOk(cmd, args, cwd, env = process.env) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if ((r.status ?? 1) !== 0) {
    console.error(`[ecosystem-stack] ${cmd} ${args.join(' ')} failed`);
    if (r.stdout) console.error(r.stdout);
    if (r.stderr) console.error(r.stderr);
    throw new Error(`${cmd} failed`);
  }
}

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => JSON.parse(x));
}

function latestRunDir(root) {
  const runsRoot = join(root, '.aqa', 'runs');
  const ids = readdirSync(runsRoot).sort();
  if (ids.length === 0) throw new Error('no run directories found');
  return { runId: ids[ids.length - 1], runDir: join(runsRoot, ids[ids.length - 1]) };
}

function routeMatch(template, pathname) {
  const t = template.split('/').filter(Boolean);
  const p = pathname.split('/').filter(Boolean);
  if (t.length !== p.length) return null;
  const params = {};
  for (let i = 0; i < t.length; i += 1) {
    const ti = t[i];
    const pi = p[i];
    if (ti.startsWith(':')) {
      params[ti.slice(1)] = decodeURIComponent(pi);
    } else if (ti !== pi) {
      return null;
    }
  }
  return params;
}

const sut = spawn('bun', ['run', 'src/server.ts'], {
  cwd: FIXTURE,
  env: { ...process.env, PORT: String(SUT_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let sutReady = false;
sut.stdout.on('data', (d) => {
  const s = String(d);
  if (!sutReady && s.toLowerCase().includes('listening')) sutReady = true;
});
sut.on('exit', (code) => {
  if (!shutdownStarted) {
    console.error(`[ecosystem-stack] SUT exited early with code ${code ?? -1}`);
    process.exit(1);
  }
});

mustOk('bun', ['install'], FIXTURE);
if (!sutReady) {
  const start = Date.now();
  while (!sutReady && Date.now() - start < 10_000) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

mustOk('node', [AQA_BIN, 'init', '--silent'], FIXTURE);
writeFileSync(
  join(FIXTURE, '.aqa', 'project.yaml'),
  `schema_version: "1"
name: gescat
stack:
  runtime: bun
  framework: hono
  db: []
  package_manager: bun
sut:
  type: api
  base_url: http://127.0.0.1:${SUT_PORT}
tags: []
`,
  'utf8',
);
writeFileSync(
  join(FIXTURE, '.aqa', 'profiles.yaml'),
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
      - pack-ecosystem-live
    tags:
      - smoke
`,
  'utf8',
);
const packRoot = join(FIXTURE, 'packs', 'pack-ecosystem-live');
cpSync(join(ROOT, 'packs', 'core'), packRoot, { recursive: true, force: true });
mkdirSync(join(packRoot, 'scenarios'), { recursive: true });
writeFileSync(
  join(packRoot, 'pack.yaml'),
  `schema_version: "1"
name: pack-ecosystem-live
version: 0.1.0
description: live ecosystem smoke fixture
author: ci
license: MIT
applies_when:
  sut_type: [api]
templates: []
scenarios:
  - scenarios/live-finding.yaml
risks: []
oracles: []
probes: []
`,
  'utf8',
);
writeFileSync(
  join(packRoot, 'scenarios', 'live-finding.yaml'),
  `schema_version: "1"
id: scn-ecosystem-live-finding
title: ecosystem smoke emits a finding visible in admin
risk_refs: [r-ecosystem-live]
invariant_refs: [inv-ecosystem-live]
preconditions: []
steps:
  - id: probe-items
    kind: http
    with: { method: "GET", url: "/items/smoke" }
oracles:
  - id: wrong-expected
    kind: http_status
    with: { expected: 201 }
tags: [smoke]
`,
  'utf8',
);

mustOk('node', [AQA_BIN, 'run', '--profile', 'smoke'], FIXTURE);
const { runId, runDir } = latestRunDir(FIXTURE);
const events = readJsonl(join(runDir, 'events.jsonl'));
const findings = readJsonl(join(runDir, 'findings.jsonl'));
if (findings.length === 0) {
  throw new Error('expected at least one finding for ecosystem live smoke');
}

const runStarted = events.find((e) => e.kind === 'run_started');
const runFinished = events.find((e) => e.kind === 'run_finished');
const runSummary = {
  schema_version: '1',
  id: runId,
  started_at: runStarted?.ts ?? new Date().toISOString(),
  finished_at: runFinished?.ts ?? new Date().toISOString(),
  state: 'succeeded',
  project: 'gescat',
  profile: 'smoke',
  execution_mode: 'orchestrator',
  config_snapshot: {
    profile: 'smoke',
    execution_mode: 'orchestrator',
    packs: ['pack-ecosystem-live'],
    config_hash: 'a'.repeat(64),
  },
  totals: {
    scenarios: Number(runFinished?.payload?.scenarios_run ?? 1),
    findings: findings.length,
    probes: 1,
    llm_tokens_in: 0,
    llm_tokens_out: 0,
    llm_cost_usd: 0,
  },
  artifact_dir: runDir,
};

const { MemoryStore } = await import('../packages/store/dist/index.js');
const { makeApi, RunnerQueue } = await import('../packages/server/dist/index.js');
const store = new MemoryStore();
await store.saveOrg({
  schema_version: '1',
  slug: 'padosoft',
  name: 'Padosoft',
  created_at: new Date().toISOString(),
});
await store.saveProject({
  schema_version: '1',
  org: 'padosoft',
  slug: 'gescat',
  name: 'Gescat',
});
await store.saveRun(runSummary);
for (const ev of events) await store.appendEvent(ev);
for (const f of findings) await store.appendFinding(f);

const api = makeApi();
const ctx = {
  store,
  queue: new RunnerQueue(),
  authenticate: async () => ({
    id: 'usr-admin',
    email: 'admin@example.test',
    display_name: 'Admin',
    roles: ['admin'],
  }),
  projectRoot: FIXTURE,
};

const apiServer = createServer(async (req, res) => {
  try {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type,x-aqa-org,x-aqa-project');
    if ((req.method ?? 'GET') === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${API_PORT}`);
    let found = null;
    for (const r of api) {
      if (r.method !== method) continue;
      const pathParams = routeMatch(r.path, url.pathname);
      if (pathParams) {
        found = { route: r, pathParams };
        break;
      }
    }
    if (!found) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'route not found' }));
      return;
    }
    let body;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      body = raw ? JSON.parse(raw) : undefined;
    }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k] = Array.isArray(v) ? v.join(',') : String(v ?? '');
    }
    const params = { ...Object.fromEntries(url.searchParams.entries()), ...found.pathParams };
    const out = await found.route.handle({ headers, params, body }, ctx);
    if (
      found.route.path === '/api/audit' &&
      out.status === 200 &&
      out.body &&
      Array.isArray(out.body.events)
    ) {
      out.body.events = [...out.body.events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    }
    res.writeHead(out.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.body));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : `internal error: ${String(err)}`,
      }),
    );
  }
});
await new Promise((resolve) => apiServer.listen(API_PORT, '127.0.0.1', resolve));

const admin = spawn('bun', ['run', 'dev', '--host', '127.0.0.1', '--port', String(ADMIN_PORT)], {
  cwd: join(ROOT, 'packages', 'admin'),
  env: { ...process.env, VITE_AQA_SERVER_URL: `http://127.0.0.1:${API_PORT}` },
  stdio: 'inherit',
  windowsHide: true,
});
function shutdown(code = 0) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  try {
    admin.kill('SIGTERM');
  } catch {}
  try {
    sut.kill('SIGTERM');
  } catch {}
  try {
    apiServer.close();
  } catch {}
  try {
    rmSync(SANDBOX, { recursive: true, force: true });
  } catch {}
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
admin.on('exit', (code) => shutdown(code ?? 0));
