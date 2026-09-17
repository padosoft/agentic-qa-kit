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

import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import {
  OidcSessionManager,
  PostgresScimRateLimiter,
  PostgresScimTokenStore,
  RunnerJwtAuthorizer,
  ScimRateLimiter,
  ScimTokenManager,
  allows,
} from '@aqa/auth';
import { safeErrorMessage } from '@aqa/observability';
import type { MetricsRegistry } from '@aqa/observability';
import { Event, Finding, Run } from '@aqa/schemas';
import { buildAsyncApiDocument, buildOpenApiDocument } from '@aqa/server';
import type { ApiContext, ApiHandler, EventBus, EventReplayResult } from '@aqa/server';
import type { StoreProvider } from '@aqa/store';

export interface AdminOptions {
  root: string;
  port?: number;
  host?: string;
  /** Override the local development identity with a real verifier in production. */
  authenticate?: ApiContext['authenticate'];
  /** OIDC session manager for the built-in login/callback/logout routes. */
  oidc?: OidcSessionManager;
  /** Whether OIDC cookies should carry Secure. Defaults to true off loopback. */
  oidcSecureCookie?: boolean;
  /** Explicit cross-origin allowlist; empty by default because the SPA is same-origin. */
  corsOrigins?: readonly string[];
  /** Enforce server-side org/project membership after authentication. */
  authorizeScope?: ApiContext['authorizeScope'];
  /** Verify dedicated runner credentials for dequeue/ACK routes. */
  runnerAuthorize?: ApiContext['runnerAuthorize'];
  /** Verify dedicated SCIM bearer credentials for provisioning routes. */
  scimAuthorize?: ApiContext['scimAuthorize'];
  /** Override the default bounded process-local SCIM abuse limiter. */
  scimRateLimit?: ApiContext['scimRateLimit'];
  /** PostgreSQL DSN for a shared SCIM abuse limiter in HA deployments. */
  scimRateLimitDsn?: string;
  /** Operator-managed Ed25519 trust root for imported packs. */
  packTrustedKeys?: ApiContext['packTrustedKeys'];
  /** Convenience adapter for the standard Bearer <id>.<secret> transport. */
  scimTokenManager?: ScimTokenManager;
  /** PostgreSQL DSN for the built-in durable SCIM token store. */
  scimTokenDsn?: string;
  /** Use a durable PostgreSQL runner queue instead of the local memory queue. */
  queueDsn?: string;
  /** Inject a queue implementation (useful for host applications/tests). */
  queue?: ApiContext['queue'];
  /** Use PostgreSQL LISTEN/NOTIFY fan-out for live admin integrations. */
  eventBusDsn?: string;
  /** Inject an event bus (useful for host applications/tests). */
  eventBus?: EventBus;
  /** Use a durable PostgreSQL control-plane store instead of MemoryStore. */
  storeDsn?: string;
  /** Inject a store implementation (useful for host applications/tests). */
  store?: ApiContext['store'];
  /** PostgreSQL DSN for shared API idempotency in HA deployments. */
  idempotencyDsn?: string;
  /** Inject an API idempotency store (useful for host applications/tests). */
  idempotency?: ApiContext['idempotency'];
  /** PostgreSQL DSN for the shared LLM budget kill-switch. */
  budgetDsn?: string;
  /** Inject a budget kill-switch controller (useful for host applications/tests). */
  budgetControl?: ApiContext['budgetControl'];
  /** Optional bounded Prometheus registry exposed at GET /metrics. */
  metrics?: MetricsRegistry;
  /** Authorize Prometheus scrapes when metrics are exposed off loopback. */
  metricsAuthorize?: (headers: Record<string, string>) => Promise<boolean> | boolean;
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

function bearerTokenAuthorizer(expected: string): NonNullable<ApiContext['runnerAuthorize']> {
  const expectedDigest = createHash('sha256').update(expected).digest();
  return async (headers) => {
    const value = headers.authorization ?? headers.Authorization ?? '';
    if (!value.startsWith('Bearer ')) return false;
    const actualDigest = createHash('sha256').update(value.slice(7)).digest();
    return timingSafeEqual(actualDigest, expectedDigest);
  };
}

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
  const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return { ok: false, error: `admin: --port must be an integer 0..65535, got ${port}` };
  }
  if (!loopbackHosts.has(host) && opts.metrics && !opts.metricsAuthorize) {
    return {
      ok: false,
      error: 'admin: metricsAuthorize is required when metrics are exposed off loopback',
    };
  }
  if (!loopbackHosts.has(host) && !opts.authenticate && !opts.oidc) {
    return {
      ok: false,
      error: 'admin: non-loopback bind requires an explicit authenticate callback (OIDC/JWT)',
    };
  }
  if (opts.authenticate && opts.oidc) {
    return { ok: false, error: 'admin: pass authenticate or oidc, not both' };
  }
  let corsOrigins: ReadonlySet<string>;
  try {
    corsOrigins = new Set(
      (opts.corsOrigins ?? []).map((origin) => {
        const parsed = new URL(origin);
        if (parsed.pathname !== '/' || parsed.search || parsed.hash)
          throw new Error('origin must not contain a path, query or hash');
        return parsed.origin;
      }),
    );
  } catch {
    return { ok: false, error: 'admin: corsOrigins must contain valid origins only' };
  }
  if (
    (opts.scimAuthorize && (opts.scimTokenManager || opts.scimTokenDsn)) ||
    (opts.scimTokenManager && opts.scimTokenDsn)
  ) {
    return {
      ok: false,
      error: 'admin: pass only one of scimAuthorize, scimTokenManager or scimTokenDsn',
    };
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

  // Dynamic imports keep the bundle slim: makeApi() + queues + stores are
  // only needed when `aqa admin` is actually invoked.
  // (The kit↔server static cycle that motivated this pattern in an
  // earlier iteration was resolved by extracting `runPackNew` into
  // `@aqa/pack-author`; the dynamic import is now an optimisation, not
  // a workaround.)
  const {
    makeApi,
    PostgresApiIdempotencyStore,
    PostgresBudgetLedger,
    PostgresEventBus,
    PostgresRunnerQueue,
    RunnerQueue,
  } = await import('@aqa/server');
  const { MemoryStore, PostgresStore } = await import('@aqa/store');

  if (opts.store && opts.storeDsn) {
    return { ok: false, error: 'admin: pass store or storeDsn, not both' };
  }
  const storeDsn = opts.storeDsn ?? process.env.AQA_STORE_DSN;
  const store = opts.store ?? (storeDsn ? new PostgresStore(storeDsn) : new MemoryStore());
  if (opts.idempotency && opts.idempotencyDsn) {
    await store.close();
    return { ok: false, error: 'admin: pass idempotency or idempotencyDsn, not both' };
  }
  const idempotencyDsn =
    opts.idempotencyDsn ?? process.env.AQA_IDEMPOTENCY_DSN ?? (storeDsn ? storeDsn : undefined);
  const idempotency =
    opts.idempotency ??
    (idempotencyDsn ? new PostgresApiIdempotencyStore(idempotencyDsn) : undefined);
  if (opts.budgetControl && opts.budgetDsn) {
    await store.close();
    await (idempotency as { close?: () => Promise<void> } | undefined)?.close?.();
    return { ok: false, error: 'admin: pass budgetControl or budgetDsn, not both' };
  }
  const budgetDsn = opts.budgetDsn ?? process.env.AQA_BUDGET_DSN;
  const budgetControl =
    opts.budgetControl ?? (budgetDsn ? new PostgresBudgetLedger(budgetDsn) : undefined);
  const seedReport = await seedStoreFromRuns(
    store,
    opts.runsRoot ?? join(opts.root, '.aqa', 'runs'),
  );

  if (opts.queue && opts.queueDsn) {
    await (budgetControl as { close?: () => Promise<void> } | undefined)?.close?.();
    return { ok: false, error: 'admin: pass queue or queueDsn, not both' };
  }
  const queueDsn = opts.queueDsn ?? process.env.AQA_QUEUE_DSN;
  const queue = opts.queue ?? (queueDsn ? new PostgresRunnerQueue(queueDsn) : new RunnerQueue());
  const runnerToken = process.env.AQA_RUNNER_TOKEN?.trim();
  const runnerJwtPublicKey = process.env.AQA_RUNNER_JWT_PUBLIC_KEY?.trim();
  const runnerJwtIssuer = process.env.AQA_RUNNER_JWT_ISSUER?.trim();
  const runnerJwtAudience = process.env.AQA_RUNNER_JWT_AUDIENCE?.trim();
  const hasRunnerJwtConfig = Boolean(runnerJwtPublicKey || runnerJwtIssuer || runnerJwtAudience);
  const runnerJwtComplete = Boolean(runnerJwtPublicKey && runnerJwtIssuer && runnerJwtAudience);
  if (hasRunnerJwtConfig && !runnerJwtComplete) {
    await store.close();
    await (queue as { close?: () => Promise<void> }).close?.();
    await (idempotency as { close?: () => Promise<void> } | undefined)?.close?.();
    await (budgetControl as { close?: () => Promise<void> } | undefined)?.close?.();
    return {
      ok: false,
      error:
        'admin: AQA_RUNNER_JWT_PUBLIC_KEY, AQA_RUNNER_JWT_ISSUER and AQA_RUNNER_JWT_AUDIENCE must be configured together',
    };
  }
  const runnerJwt = runnerJwtComplete
    ? new RunnerJwtAuthorizer({
        public_key_pem: runnerJwtPublicKey ?? '',
        issuer: runnerJwtIssuer ?? '',
        audience: runnerJwtAudience ?? '',
      })
    : undefined;
  if (queueDsn && !opts.runnerAuthorize && !runnerToken && !runnerJwt) {
    await store.close();
    await (queue as { close?: () => Promise<void> }).close?.();
    await (idempotency as { close?: () => Promise<void> } | undefined)?.close?.();
    await (budgetControl as { close?: () => Promise<void> } | undefined)?.close?.();
    return {
      ok: false,
      error: 'admin: durable runner queue requires runnerAuthorize or AQA_RUNNER_TOKEN',
    };
  }
  if (opts.eventBus && opts.eventBusDsn) {
    await store.close();
    const closableQueue = queue as { close?: () => Promise<void> };
    await closableQueue.close?.();
    await (idempotency as { close?: () => Promise<void> } | undefined)?.close?.();
    await (budgetControl as { close?: () => Promise<void> } | undefined)?.close?.();
    return { ok: false, error: 'admin: pass eventBus or eventBusDsn, not both' };
  }
  const eventBusDsn = opts.eventBusDsn ?? process.env.AQA_EVENT_BUS_DSN;
  const eventBus = opts.eventBus ?? (eventBusDsn ? new PostgresEventBus(eventBusDsn) : undefined);
  const scimTokenDsn = opts.scimTokenDsn ?? process.env.AQA_SCIM_TOKEN_DSN;
  const scimTokenStore = scimTokenDsn ? new PostgresScimTokenStore(scimTokenDsn) : undefined;
  const scimTokenManager =
    opts.scimTokenManager ?? (scimTokenStore ? new ScimTokenManager(scimTokenStore) : undefined);
  const scimRateLimitDsn = opts.scimRateLimitDsn ?? process.env.AQA_SCIM_RATE_LIMIT_DSN;
  const scimRateLimiter = scimRateLimitDsn
    ? new PostgresScimRateLimiter(scimRateLimitDsn)
    : new ScimRateLimiter();
  const api = makeApi();
  const ctx = {
    store,
    queue,
    authenticate:
      opts.authenticate ??
      (opts.oidc ? async (headers) => opts.oidc?.authenticateAsync(headers) ?? null : undefined) ??
      (async () => ({
        id: 'usr-local',
        email: 'local@aqa.test',
        display_name: 'Local',
        // 'admin' role short-circuits permission checks in @aqa/auth.
        roles: ['admin' as const],
      })),
    ...(opts.runnerAuthorize
      ? { runnerAuthorize: opts.runnerAuthorize }
      : runnerJwt
        ? { runnerAuthorize: (headers: Record<string, string>) => runnerJwt.authorize(headers) }
        : runnerToken
          ? { runnerAuthorize: bearerTokenAuthorizer(runnerToken) }
          : {}),
    ...(opts.scimAuthorize
      ? { scimAuthorize: opts.scimAuthorize }
      : scimTokenManager
        ? {
            scimAuthorize: (headers: Record<string, string>, org: string) =>
              scimTokenManager.verifyBearer(org, headers.authorization ?? headers.Authorization),
          }
        : {}),
    ...(opts.scimRateLimit
      ? { scimRateLimit: opts.scimRateLimit }
      : opts.scimAuthorize || scimTokenManager
        ? { scimRateLimit: (org: string) => scimRateLimiter.allow(org) }
        : {}),
    ...(opts.authorizeScope ? { authorizeScope: opts.authorizeScope } : {}),
    ...(opts.packTrustedKeys ? { packTrustedKeys: opts.packTrustedKeys } : {}),
    ...(eventBus ? { eventBus } : {}),
    ...(idempotency ? { idempotency } : {}),
    ...(budgetControl ? { budgetControl } : {}),
    projectRoot: opts.root,
  };

  const server = createServer((req, res) => {
    handleRequest(req, res, {
      api,
      ctx,
      adminDistDir,
      indexHtmlPath,
      ...(opts.oidc ? { oidc: opts.oidc } : {}),
      ...(opts.oidc ? { oidcSecureCookie: opts.oidcSecureCookie ?? !loopbackHosts.has(host) } : {}),
      corsOrigins,
      ...(opts.metrics ? { metrics: opts.metrics } : {}),
      ...(opts.metricsAuthorize ? { metricsAuthorize: opts.metricsAuthorize } : {}),
    }).catch((err: unknown) => {
      try {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: safeErrorMessage(err),
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
      `[admin] seeded ${seedReport.runs} local run(s), ${seedReport.events} event(s), ${seedReport.findings} finding(s) into the configured store`,
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
    close: async () => {
      await closeServer(server);
      const closable = queue as { close?: () => Promise<void> };
      await closable.close?.();
      await store.close();
      await (idempotency as { close?: () => Promise<void> } | undefined)?.close?.();
      await (budgetControl as { close?: () => Promise<void> } | undefined)?.close?.();
      await eventBus?.close();
      await scimTokenStore?.close();
      if ('close' in scimRateLimiter) await scimRateLimiter.close();
      await opts.oidc?.close();
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function defaultAdminDistDir(): string {
  // This file compiles to dist/commands/admin.js; the bundled SPA sits
  // at dist/admin/. Resolve from the command entrypoint so the published CJS
  // bundle does not depend on import.meta, while direct ESM commands remain
  // usable during development.
  const moduleDir = commandModuleDir();
  const bundledPath = resolve(moduleDir, 'admin');
  const sourcePath = resolve(moduleDir, '..', 'admin');
  if (existsSync(bundledPath)) return bundledPath;
  if (existsSync(sourcePath)) return sourcePath;

  return normalize(sourcePath);
}

function commandModuleDir(): string {
  if (typeof __dirname !== 'undefined') return __dirname;
  const entry = process.argv[1];
  const name = entry ? basename(entry) : '';
  if (entry && (name === 'cli.cjs' || name === 'run.js' || name === 'admin.js'))
    return dirname(resolve(entry));
  return resolve(process.cwd(), 'dist', 'commands');
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
      state: Run.deriveStateFromCompletion(
        runFinished,
        readPayloadNumber(runFinished, 'scenarios_run') ?? 0,
      ),
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
  oidc?: OidcSessionManager;
  oidcSecureCookie?: boolean;
  corsOrigins: ReadonlySet<string>;
  metrics?: MetricsRegistry;
  metricsAuthorize?: (headers: Record<string, string>) => Promise<boolean> | boolean;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  hctx: HandleCtx,
): Promise<void> {
  const requestOrigin = req.headers.origin;
  const allowedOrigin =
    requestOrigin && hctx.corsOrigins.has(requestOrigin) ? requestOrigin : undefined;
  if (allowedOrigin) {
    res.setHeader('access-control-allow-origin', allowedOrigin);
    res.setHeader('access-control-allow-credentials', 'true');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader(
      'access-control-allow-headers',
      'authorization,content-type,cookie,idempotency-key,if-match,x-aqa-org,x-aqa-project',
    );
    res.setHeader('vary', 'Origin');
  }

  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    if (requestOrigin && !allowedOrigin) {
      res.statusCode = 403;
      res.end();
      return;
    }
    res.statusCode = 204;
    res.end();
    return;
  }
  if (requestOrigin && !allowedOrigin && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    res.statusCode = 403;
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

  if (method === 'GET' && url.pathname === '/metrics') {
    if (!hctx.metrics) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers))
      headers[key] = Array.isArray(value) ? value.join(',') : String(value ?? '');
    if (hctx.metricsAuthorize && !(await hctx.metricsAuthorize(headers))) {
      res.statusCode = 401;
      res.setHeader('cache-control', 'no-store');
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(hctx.metrics.renderPrometheus());
    return;
  }

  // The contract contains route metadata only (no tenant data or secrets),
  // so clients and auditors can discover it without an authenticated session.
  if (method === 'GET' && url.pathname === '/openapi.json') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/vnd.oai.openapi+json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(buildOpenApiDocument(hctx.api)));
    return;
  }
  if (method === 'GET' && url.pathname === '/asyncapi.json') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/asyncapi+json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(buildAsyncApiDocument()));
    return;
  }

  if (hctx.oidc && method === 'GET' && url.pathname === '/auth/login') {
    const login = await hctx.oidc.begin();
    res.statusCode = 302;
    res.setHeader('location', login.authorization_url);
    res.setHeader('cache-control', 'no-store');
    res.end();
    return;
  }
  if (hctx.oidc && method === 'GET' && url.pathname === '/auth/callback') {
    try {
      const completed = await hctx.oidc.complete(
        url.searchParams.get('state') ?? '',
        url.searchParams.get('code') ?? '',
      );
      res.statusCode = 302;
      res.setHeader('location', '/');
      res.setHeader(
        'set-cookie',
        OidcSessionManager.sessionCookie(completed.token, hctx.oidcSecureCookie),
      );
      res.setHeader('cache-control', 'no-store');
      res.end();
    } catch (error) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: safeErrorMessage(error, 'OIDC callback failed') }));
    }
    return;
  }
  if (hctx.oidc && method === 'POST' && url.pathname === '/auth/logout') {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value.join(',') : String(value ?? '');
    }
    await hctx.oidc.revokeAsync(headers);
    res.statusCode = 204;
    res.setHeader('set-cookie', OidcSessionManager.clearCookie(hctx.oidcSecureCookie));
    res.end();
    return;
  }

  if (method === 'GET' && url.pathname === '/api/events/stream') {
    await handleEventStream({ req, res, url, hctx });
    return;
  }

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/scim/')) {
    await delegateToApi({ req, res, url, method, hctx });
    return;
  }

  serveStatic({ req, res, url, hctx });
}

async function handleEventStream(args: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  hctx: HandleCtx;
}): Promise<void> {
  const { req, res, url, hctx } = args;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value.join(',') : String(value ?? '');
  }
  const user = await hctx.ctx.authenticate(headers);
  if (!user) {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  if (!allows(user, 'runs:read')) {
    res.statusCode = 403;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'forbidden: requires runs:read' }));
    return;
  }
  const org = headers['x-aqa-org'] ?? headers['X-Aqa-Org'] ?? url.searchParams.get('org') ?? '';
  const project =
    headers['x-aqa-project'] ?? headers['X-Aqa-Project'] ?? url.searchParams.get('project') ?? '';
  if (!org.trim()) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'event stream requires an org scope' }));
    return;
  }
  if (
    hctx.ctx.authorizeScope &&
    !(await hctx.ctx.authorizeScope(user, { org, ...(project ? { project } : {}) }))
  ) {
    res.statusCode = 403;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'forbidden: user is not a member of the requested scope' }));
    return;
  }
  if (!hctx.ctx.eventBus) {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'live event streaming is not configured' }));
    return;
  }

  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': heartbeat\n\n');
  }, 15_000);
  heartbeat.unref?.();
  const seenIds = new Set<string>();
  const writeEvent = (event: { id: string; type: string; data: Record<string, unknown> }): void => {
    if (closed || seenIds.has(event.id)) return;
    seenIds.add(event.id);
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const unsubscribe = await hctx.ctx.eventBus.subscribe((event) => {
    if (closed || event.org !== org || (project && event.project !== project)) return;
    writeEvent(event);
  });
  const cleanup = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    await unsubscribe();
  };
  req.once('aborted', () => void cleanup());
  res.once('close', () => void cleanup());

  const afterId = headers['last-event-id'] ?? headers['Last-Event-ID'];
  let replay: EventReplayResult | undefined;
  try {
    replay = await hctx.ctx.eventBus.replay?.({
      ...(afterId ? { after_id: afterId } : {}),
      org,
      ...(project ? { project } : {}),
      limit: 100,
    });
  } catch {
    if (!closed) {
      res.write(
        `event: stream.gap\ndata: ${JSON.stringify({ reason: 'replay_unavailable', recovery: 'refetch' })}\n\n`,
      );
    }
    return;
  }
  if (replay && !replay.cursor_found && !closed) {
    res.write(
      `event: stream.gap\ndata: ${JSON.stringify({ reason: 'cursor_not_found', recovery: 'refetch' })}\n\n`,
    );
  }
  for (const event of replay?.events ?? []) writeEvent(event);
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
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    body = raw ? JSON.parse(raw) : undefined;
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = Array.isArray(v) ? v.join(',') : String(v ?? '');
  }
  if (matched.route.requires !== null) {
    const user = await hctx.ctx.authenticate(headers);
    if (!user) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (!allows(user, matched.route.requires)) {
      res.statusCode = 403;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: `forbidden: requires ${matched.route.requires}` }));
      return;
    }
    const org = headers['x-aqa-org'] ?? headers['X-Aqa-Org'];
    const project = headers['x-aqa-project'] ?? headers['X-Aqa-Project'];
    await hctx.ctx.store.upsertUser(
      {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        roles: user.roles,
        status: 'active',
        last_active_at: new Date().toISOString(),
      },
      org ? { org, ...(project ? { project } : {}) } : undefined,
    );
    if (hctx.ctx.authorizeScope && typeof org === 'string') {
      const requestedScope = project ? { org, project } : { org };
      if (!(await hctx.ctx.authorizeScope(user, requestedScope))) {
        res.statusCode = 403;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({ error: 'forbidden: user is not a member of the requested scope' }),
        );
        return;
      }
    }
  }
  const params: Record<string, string> = {
    ...Object.fromEntries(url.searchParams.entries()),
    ...matched.params,
  };
  const out = await matched.route.handle({ headers, params, body }, hctx.ctx);
  res.statusCode = out.status;
  res.setHeader('content-type', 'application/json');
  for (const [name, value] of Object.entries(out.headers ?? {})) {
    res.setHeader(name, value);
  }
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
