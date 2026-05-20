/**
 * `aqa admin` — boots the admin SPA + API in a single local process.
 *
 * The kit ships a prebuilt copy of the admin SPA inside its own
 * `dist/admin/` (see scripts/bundle-admin.mjs). At boot we wire
 * `@aqa/server.makeApi()` against an in-memory store seeded with the
 * project's local runs, then serve the SPA over the same `node:http`
 * server. Routes:
 *
 *   GET  /api/healthz          → `{ ok: true }` (kit-owned, not in makeApi)
 *   *    /api/*                → delegated to makeApi() handlers
 *   *    everything else       → static file served from dist/admin/,
 *                                index.html fallback for SPA routing.
 *
 * The store seed mirrors `scripts/ecosystem-stack.mjs` — we walk
 * `.aqa/runs/<id>/{events,findings}.jsonl` and feed each entry to the
 * memory store so the admin shows real local runs out of the box, not
 * an empty list. Per-run reconstruction uses the same logic as
 * `aqa report`, kept local here to avoid a circular dep on report.ts
 * (report.ts owns the Markdown rendering; this file owns the boot).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { Event, Finding, Run } from '@aqa/schemas';
import type { ApiContext, ApiHandler } from '@aqa/server';
import type { StoreProvider } from '@aqa/store';

export interface AdminOptions {
  root: string;
  port?: number;
  host?: string;
  /**
   * Override the directory the SPA is served from. Default is the
   * `dist/admin/` co-located with the running kit's dist. Tests use
   * this to point at a fixture without copying it.
   */
  adminDistDir?: string;
  /**
   * Override the directory scanned for run artifacts. Default is
   * `${root}/.aqa/runs/`.
   */
  runsRoot?: string;
}

export interface AdminHandle {
  /** Resolved port — useful when caller asked for port=0 (auto). */
  port: number;
  /** Resolved host. */
  host: string;
  url: string;
  /** Stops the server and frees its socket. Idempotent. */
  close: () => Promise<void>;
}

export interface AdminErr {
  ok: false;
  error: string;
}

export type AdminBootResult = ({ ok: true } & AdminHandle) | AdminErr;

const DEFAULT_PORT = 5173;
const DEFAULT_HOST = '127.0.0.1';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export async function runAdmin(opts: AdminOptions): Promise<AdminBootResult> {
  const port = opts.port ?? DEFAULT_PORT;
  const host = opts.host ?? DEFAULT_HOST;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return { ok: false, error: `admin: --port must be an integer 0..65535, got ${port}` };
  }

  const adminDistDir = opts.adminDistDir ?? defaultAdminDistDir();
  if (!existsSync(adminDistDir) || !statSync(adminDistDir).isDirectory()) {
    return {
      ok: false,
      error: `admin: bundled SPA not found at ${adminDistDir} — reinstall @aqa/kit or run \`bun run build\` from the monorepo root`,
    };
  }
  const indexHtmlPath = join(adminDistDir, 'index.html');
  if (!existsSync(indexHtmlPath)) {
    return {
      ok: false,
      error: `admin: ${indexHtmlPath} is missing — bundled SPA is incomplete`,
    };
  }

  // Lazy dynamic imports break what would otherwise be a static dependency
  // cycle: @aqa/server depends on @aqa/kit (for runPackNew). Dynamic import
  // keeps the cycle out of the module-load graph and out of any future
  // esbuild bundle that doesn't statically follow these specifiers.
  const { makeApi, RunnerQueue } = await import('@aqa/server');
  const { MemoryStore } = await import('@aqa/store');

  const store = new MemoryStore();
  const seedReport = await seedStoreFromRuns(
    store,
    opts.runsRoot ?? join(opts.root, '.aqa', 'runs'),
  );

  const api = makeApi();
  const ctx = {
    store,
    queue: new RunnerQueue(),
    authenticate: async () => ({
      id: 'usr-local',
      email: 'local@aqa.test',
      display_name: 'Local',
      // 'admin' role short-circuits permission checks in @aqa/auth.
      roles: ['admin' as const],
    }),
    projectRoot: opts.root,
  };

  const server = createServer((req, res) => {
    handleRequest(req, res, { api, ctx, adminDistDir, indexHtmlPath }).catch((err: unknown) => {
      try {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : `internal error: ${String(err)}`,
          }),
        );
      } catch {
        // headers already sent
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (e: Error): void => {
      server.off('listening', onListen);
      reject(e);
    };
    const onListen = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListen);
    server.listen(port, host);
  }).catch((e: Error) => {
    throw e;
  });

  const address = server.address();
  const resolvedPort = typeof address === 'object' && address !== null ? address.port : port;

  // Log seed summary so the junior sees their local runs were detected.
  if (seedReport.runs > 0) {
    console.info(
      `[admin] seeded ${seedReport.runs} local run(s), ${seedReport.events} event(s), ${seedReport.findings} finding(s) into the in-memory store`,
    );
  } else {
    console.info(
      '[admin] no local runs found under .aqa/runs/ — admin will start empty; run `aqa run --profile smoke` first',
    );
  }

  return {
    ok: true,
    port: resolvedPort,
    host,
    url: `http://${host}:${resolvedPort}`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function defaultAdminDistDir(): string {
  // This file compiles to dist/commands/admin.js; the bundled SPA sits
  // at dist/admin/. Resolve relative to the current ESM URL so it works
  // both in the source tree and inside an npm-installed tarball.
  // Using import.meta.url keeps this self-contained — no env var, no
  // build-time string substitution.
  const url = new URL('../admin/', import.meta.url);
  // pathname is URL-encoded; on Windows it begins with `/C:/...` which
  // node treats as a valid path when normalized.
  let p = decodeURIComponent(url.pathname);
  if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(p)) {
    p = p.slice(1);
  }
  return normalize(p.replace(/\/+$/, ''));
}

interface SeedReport {
  runs: number;
  events: number;
  findings: number;
}

async function seedStoreFromRuns(store: StoreProvider, runsRoot: string): Promise<SeedReport> {
  const report: SeedReport = { runs: 0, events: 0, findings: 0 };
  if (!existsSync(runsRoot) || !statSync(runsRoot).isDirectory()) return report;

  let entries: string[];
  try {
    entries = readdirSync(runsRoot);
  } catch {
    return report;
  }

  for (const name of entries) {
    const runDir = join(runsRoot, name);
    let runStat: ReturnType<typeof statSync> | undefined;
    try {
      runStat = statSync(runDir);
    } catch {
      continue;
    }
    if (!runStat || !runStat.isDirectory()) continue;

    const eventsPath = join(runDir, 'events.jsonl');
    const findingsPath = join(runDir, 'findings.jsonl');
    if (!existsSync(eventsPath)) continue;

    const events = readJsonlSafe(eventsPath);
    const findings = existsSync(findingsPath) ? readJsonlSafe(findingsPath) : [];

    const runStarted = events.find((e) => e.kind === 'run_started');
    const runFinished = events.find((e) => e.kind === 'run_finished');
    const profile = readPayloadString(runStarted, 'profile') ?? 'unknown';
    const project = readPayloadString(runStarted, 'project') ?? 'unknown';
    const startedAt =
      (typeof runStarted?.ts === 'string' && runStarted.ts) || new Date(0).toISOString();
    const finishedAt = typeof runFinished?.ts === 'string' ? runFinished.ts : undefined;
    const runDraft = {
      schema_version: '1' as const,
      id: name,
      started_at: startedAt,
      ...(finishedAt ? { finished_at: finishedAt } : {}),
      state: (runFinished ? 'succeeded' : 'running') as Run.RunState,
      project,
      profile,
      execution_mode: 'orchestrator' as const,
      config_snapshot: {
        profile,
        execution_mode: 'orchestrator' as const,
        packs: [],
        config_hash: '0'.repeat(64),
      },
      totals: {
        scenarios: readPayloadNumber(runFinished, 'scenarios_run') ?? 0,
        findings: readPayloadNumber(runFinished, 'findings') ?? findings.length,
        probes: 0,
        llm_tokens_in: 0,
        llm_tokens_out: 0,
        llm_cost_usd: 0,
      },
      artifact_dir: runDir,
    };
    const parsedRun = Run.Run.safeParse(runDraft);
    if (!parsedRun.success) {
      console.warn(
        `[admin] skipped run ${name}: invalid Run shape — ${parsedRun.error.message.split('\n')[0]}`,
      );
      continue;
    }

    try {
      await store.saveRun(parsedRun.data);
      let acceptedEvents = 0;
      for (const raw of events) {
        const ev = Event.Event.safeParse(raw);
        if (!ev.success) continue;
        await store.appendEvent(ev.data);
        acceptedEvents += 1;
      }
      let acceptedFindings = 0;
      for (const raw of findings) {
        const f = Finding.Finding.safeParse(raw);
        if (!f.success) continue;
        await store.appendFinding(f.data);
        acceptedFindings += 1;
      }
      report.runs += 1;
      report.events += acceptedEvents;
      report.findings += acceptedFindings;
    } catch (e) {
      console.warn(`[admin] skipped run ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return report;
}

function readJsonlSafe(path: string): Array<Record<string, unknown>> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown>> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as unknown;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        out.push(obj as Record<string, unknown>);
      }
    } catch {
      // tolerate malformed lines so a single broken run doesn't take the
      // whole admin down at boot. report.ts is strict; admin is lenient.
    }
  }
  return out;
}

function readPayloadString(
  obj: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const payload = obj?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

function readPayloadNumber(
  obj: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const payload = obj?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

interface HandleCtx {
  api: readonly ApiHandler[];
  ctx: ApiContext;
  adminDistDir: string;
  indexHtmlPath: string;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  hctx: HandleCtx,
): Promise<void> {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-aqa-org,x-aqa-project');

  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');

  // Kit-owned healthz: trivial, always-200. Lets the test (and any
  // junior smoke check) confirm the server is up without depending on
  // makeApi's auth surface or store state.
  if (url.pathname === '/api/healthz') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    await delegateToApi({ req, res, url, method, hctx });
    return;
  }

  serveStatic({ req, res, url, hctx });
}

async function delegateToApi(args: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  hctx: HandleCtx;
}): Promise<void> {
  const { req, res, url, method, hctx } = args;
  let matched: {
    route: HandleCtx['api'][number];
    params: Record<string, string>;
  } | null = null;
  for (const r of hctx.api) {
    if (r.method !== method) continue;
    const params = routeMatch(r.path, url.pathname);
    if (params) {
      matched = { route: r, params };
      break;
    }
  }
  if (!matched) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'route not found' }));
    return;
  }

  let body: unknown;
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    body = raw ? JSON.parse(raw) : undefined;
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = Array.isArray(v) ? v.join(',') : String(v ?? '');
  }
  const params: Record<string, string> = {
    ...Object.fromEntries(url.searchParams.entries()),
    ...matched.params,
  };
  const out = await matched.route.handle({ headers, params, body }, hctx.ctx);
  res.statusCode = out.status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(out.body));
}

function routeMatch(template: string, pathname: string): Record<string, string> | null {
  const t = template.split('/').filter(Boolean);
  const p = pathname.split('/').filter(Boolean);
  if (t.length !== p.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < t.length; i += 1) {
    const ti = t[i] as string;
    const pi = p[i] as string;
    if (ti.startsWith(':')) {
      params[ti.slice(1)] = decodeURIComponent(pi);
    } else if (ti !== pi) {
      return null;
    }
  }
  return params;
}

function serveStatic(args: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  hctx: HandleCtx;
}): void {
  const { res, url, hctx } = args;
  // Map `/` → `index.html`; everything else is resolved under adminDistDir.
  // Reject any candidate that resolves outside adminDistDir (path traversal).
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const candidate = normalize(join(hctx.adminDistDir, rel));
  if (!candidate.startsWith(hctx.adminDistDir + sep) && candidate !== hctx.adminDistDir) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    const ext = extname(candidate).toLowerCase();
    res.statusCode = 200;
    res.setHeader('content-type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
    res.end(readFileSync(candidate));
    return;
  }

  // SPA fallback: unknown paths return index.html so client-side routing
  // takes over. Don't fallback on /api/* (already handled) or asset
  // paths under /assets/ (which should 404 if truly missing).
  if (url.pathname.startsWith('/assets/')) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', CONTENT_TYPES['.html'] ?? 'text/html');
  res.end(readFileSync(hctx.indexHtmlPath));
}
