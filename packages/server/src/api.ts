import type { User, allows } from '@aqa/auth';
import { runPackNew } from '@aqa/kit';
import type { PackNewErrorCode } from '@aqa/kit';
import type {
  ApiToken,
  CostSummary,
  Event,
  Finding,
  Notification,
  PackManifest,
  Profile,
  RiskMap,
  Run,
  SavedView,
  Scenario,
  Tenancy,
} from '@aqa/schemas';
import type { StoreProvider } from '@aqa/store';
import type { RunnerQueue } from './runner-queue.js';

export interface ApiContext {
  store: StoreProvider;
  queue: RunnerQueue;
  /** Resolve the authenticated user from the request. */
  authenticate: (headers: Record<string, string>) => Promise<User | null>;
  /**
   * Absolute on-disk path of the project the server manages. Set at boot.
   * Endpoints that scaffold or modify files anchor to this path and NEVER
   * accept a client-supplied root — that would let an authenticated caller
   * write anywhere the server process can reach.
   *
   * Optional so existing tests / lightweight integrations that don't touch
   * the filesystem keep working; FS-touching endpoints return 400 when
   * unset rather than silently writing to cwd.
   */
  projectRoot?: string;
}

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ApiRequest {
  headers: Record<string, string>;
  body?: unknown;
  params: Record<string, string>;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiHandler {
  method: ApiMethod;
  path: string;
  requires: Parameters<typeof allows>[1] | null;
  handle: (req: ApiRequest, ctx: ApiContext) => Promise<ApiResponse>;
}

/**
 * Resolve the tenant scope for the request. Admin clients send
 * `x-aqa-org` / `x-aqa-project` headers; routes that need scope require
 * them present. Unscoped reads (audit list global, orgs list) accept
 * missing headers.
 */
function scope(req: ApiRequest): { org?: string; project?: string } {
  const out: { org?: string; project?: string } = {};
  const org = req.headers['x-aqa-org'] ?? req.headers['X-Aqa-Org'];
  const project = req.headers['x-aqa-project'] ?? req.headers['X-Aqa-Project'];
  if (org) out.org = org;
  if (project) out.project = project;
  return out;
}

/**
 * Map a `runPackNew` error code to an HTTP status. Stable mapping —
 * unlike regex-matching the human-readable error string, this survives
 * any rewording of the underlying error messages.
 */
function errorCodeToStatus(code: PackNewErrorCode | undefined): number {
  switch (code) {
    case 'EEXIST':
      return 409;
    case 'EIO':
      return 500;
    default:
      return 400;
  }
}

function requireScope(req: ApiRequest): { org: string; project: string } | ApiResponse {
  const s = scope(req);
  if (!s.org || !s.project) {
    return {
      status: 400,
      body: { error: 'missing tenant scope — set x-aqa-org and x-aqa-project headers' },
    };
  }
  return { org: s.org, project: s.project };
}

function asResponse(value: unknown, status = 200): ApiResponse {
  return { status, body: value };
}

function notFound(what: string): ApiResponse {
  return { status: 404, body: { error: `${what} not found` } };
}

function cryptoUuid(): string {
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}
function hex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i += 1) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/**
 * Routing table for the AQA server. Framework-agnostic — the Hono / Bun
 * wrapper picks each entry and registers it. Every handler:
 *
 *   - Validates the tenant scope via `x-aqa-org` / `x-aqa-project` headers
 *     when the resource is project-scoped.
 *   - Returns shape-compliant `@aqa/schemas` objects.
 *   - Uses the `requires` permission (or `null` for runner-only routes,
 *     gated separately by runner credential).
 *
 * The admin panel (`packages/admin`) consumes this surface end-to-end.
 */
export function makeApi(): ApiHandler[] {
  return [
    // ============ Runs ============
    {
      method: 'GET',
      path: '/api/runs',
      requires: 'runs:read',
      async handle(req, ctx) {
        // Project-scoped listing is required so that a token without scope
        // cannot leak runs across tenants. The admin always sets
        // x-aqa-project; CLI consumers must do the same.
        const s = requireScope(req);
        if ('status' in s) return s;
        const runs = await ctx.store.listRuns({ project: s.project, limit: 100 });
        return asResponse({ runs } satisfies { runs: Run.Run[] });
      },
    },
    {
      method: 'GET',
      path: '/api/runs/:id',
      requires: 'runs:read',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('run');
        const s = requireScope(req);
        if ('status' in s) return s;
        const run = await ctx.store.loadRun(id);
        // Match-or-404: a cross-tenant lookup must look identical to a missing
        // record so probing for IDs in other projects gains no information.
        if (!run || run.project !== s.project) return notFound('run');
        return asResponse({ run } satisfies { run: Run.Run });
      },
    },
    {
      method: 'POST',
      path: '/api/runs',
      requires: 'runs:create',
      async handle(req, ctx) {
        const job = ctx.queue.enqueue({
          id: cryptoUuid(),
          payload: req.body as Record<string, unknown>,
          enqueued_at: new Date().toISOString(),
        });
        return asResponse({ job }, 202);
      },
    },
    {
      method: 'GET',
      path: '/api/runs/:id/events',
      requires: 'runs:read',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('run');
        const s = requireScope(req);
        if ('status' in s) return s;
        const run = await ctx.store.loadRun(id);
        if (!run || run.project !== s.project) return notFound('run');
        const events = await ctx.store.listEvents(id);
        return asResponse({ events });
      },
    },

    // ============ Findings ============
    {
      method: 'GET',
      path: '/api/findings',
      requires: 'findings:read',
      async handle(req, ctx) {
        const filter: { run_id?: string } = {};
        if (req.params.run_id) filter.run_id = req.params.run_id;
        const findings = await ctx.store.listFindings(filter);
        return asResponse({ findings } satisfies { findings: Finding.Finding[] });
      },
    },
    {
      method: 'GET',
      path: '/api/findings/:id',
      requires: 'findings:read',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('finding');
        const s = requireScope(req);
        if ('status' in s) return s;
        const finding = await ctx.store.loadFinding(id);
        if (!finding) return notFound('finding');
        // Verify the finding's run lives in the requested project; treat
        // cross-tenant access identically to "not found".
        const run = await ctx.store.loadRun(finding.run_id);
        if (!run || run.project !== s.project) return notFound('finding');
        return asResponse({ finding });
      },
    },
    {
      method: 'POST',
      path: '/api/findings/:id/status',
      requires: 'findings:edit',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('finding');
        const user = await ctx.authenticate(req.headers);
        if (!user) return { status: 401, body: { error: 'unauthorized' } };
        const body = req.body as
          | { status?: Finding.Finding['status']; reason?: string }
          | undefined;
        if (!body?.status || !body.reason) {
          return { status: 400, body: { error: 'status + reason required' } };
        }
        const updated = await ctx.store.updateFindingStatus(id, body.status, user.id, body.reason);
        if (!updated) return notFound('finding');
        return asResponse({ finding: updated });
      },
    },

    // ============ Packs ============
    {
      method: 'GET',
      path: '/api/packs',
      requires: 'packs:read',
      async handle(req, ctx) {
        const packs = await ctx.store.listPacks(scope(req));
        return asResponse({ packs } satisfies { packs: PackManifest.PackManifest[] });
      },
    },
    {
      method: 'GET',
      path: '/api/packs/:slug',
      requires: 'packs:read',
      async handle(req, ctx) {
        const slug = req.params.slug;
        if (!slug) return notFound('pack');
        const pack = await ctx.store.loadPack(slug);
        if (!pack) return notFound('pack');
        return asResponse({ pack });
      },
    },
    {
      method: 'POST',
      path: '/api/packs',
      requires: 'packs:install',
      async handle(req, ctx) {
        const manifest = req.body as PackManifest.PackManifest;
        await ctx.store.installPack(manifest);
        return asResponse({ pack: manifest }, 201);
      },
    },
    {
      method: 'DELETE',
      path: '/api/packs/:slug',
      requires: 'packs:install',
      async handle(req, ctx) {
        const slug = req.params.slug;
        if (!slug) return notFound('pack');
        await ctx.store.uninstallPack(slug);
        return asResponse({ ok: true });
      },
    },
    {
      // v1.7 slice 3 — scaffold a new pack on disk for the Admin
      // "Create pack" wizard. Delegates to `runPackNew` from `@aqa/kit`
      // (the same code path as `aqa pack new` on the CLI) so the two
      // UIs stay in lockstep on validation, atomic --force, etc.
      //
      // Synchronous FS work in an async handler: `runPackNew` is sync
      // (mkdir / writeFile / rename of ~5 small files plus a few schema
      // validations — typical wall-clock ~10ms on a developer laptop).
      // For the admin's create-pack flow that's an explicit, infrequent
      // user action (clicked from a wizard), so blocking the event loop
      // for that brief window is an acceptable tradeoff vs the cost of
      // duplicating runPackNew's logic in an async variant. If this
      // endpoint ever gets called from a high-fanout path (e.g. bulk
      // pack import), revisit and offload.
      method: 'POST',
      path: '/api/packs/scaffold',
      requires: 'packs:install',
      async handle(req, ctx) {
        if (!ctx.projectRoot) {
          return asResponse(
            {
              error:
                'server has no projectRoot configured — pack scaffolding requires the server to know which on-disk project to write into',
            },
            400,
          );
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        // Required fields — strict type + non-empty check.
        if (typeof body.slug !== 'string' || body.slug.trim() === '') {
          return asResponse({ error: 'slug is required (non-empty string)' }, 400);
        }
        if (typeof body.sut_type !== 'string' || body.sut_type.trim() === '') {
          return asResponse({ error: 'sut_type is required (non-empty string)' }, 400);
        }
        // Optional fields — strict type check at the API boundary so a
        // client can't smuggle truthy non-booleans through `force` (which
        // `runPackNew` checks via `if (!opts.force)` truthiness). A
        // request like `{"force": "no"}` would be silently treated as
        // force-enabled without this guard.
        if (body.force !== undefined && typeof body.force !== 'boolean') {
          return asResponse(
            { error: 'force must be a boolean when provided (got non-boolean)' },
            400,
          );
        }
        for (const k of ['description', 'author', 'license'] as const) {
          const v = body[k];
          if (v !== undefined && typeof v !== 'string') {
            return asResponse(
              { error: `${k} must be a string when provided (got non-string)` },
              400,
            );
          }
        }
        const result = runPackNew({
          root: ctx.projectRoot,
          slug: body.slug,
          sutType: body.sut_type,
          ...(body.force !== undefined ? { force: body.force as boolean } : {}),
          ...(body.description !== undefined ? { description: body.description as string } : {}),
          ...(body.author !== undefined ? { author: body.author as string } : {}),
          ...(body.license !== undefined ? { license: body.license as string } : {}),
        });
        if (!result.ok) {
          // Map the structured `code` field to an HTTP status. This is
          // stable across error-message wording changes, unlike the
          // earlier regex-on-error approach.
          const httpStatus = errorCodeToStatus(result.code);
          return asResponse(
            { error: result.error ?? 'unknown error', code: result.code ?? 'EINVAL' },
            httpStatus,
          );
        }
        return asResponse({ pack_dir: result.packDir, files: result.files ?? [] }, 201);
      },
    },

    // ============ Profiles ============
    {
      method: 'GET',
      path: '/api/profiles',
      requires: 'profiles:read',
      async handle(req, ctx) {
        const profiles = await ctx.store.listProfiles(scope(req));
        return asResponse({ profiles } satisfies { profiles: Profile.Profile[] });
      },
    },
    {
      method: 'GET',
      path: '/api/profiles/:name',
      requires: 'profiles:read',
      async handle(req, ctx) {
        const name = req.params.name;
        if (!name) return notFound('profile');
        const profile = await ctx.store.loadProfile(name);
        if (!profile) return notFound('profile');
        return asResponse({ profile });
      },
    },
    {
      method: 'PUT',
      path: '/api/profiles/:name',
      requires: 'profiles:edit',
      async handle(req, ctx) {
        const profile = req.body as Profile.Profile;
        await ctx.store.saveProfile(profile);
        return asResponse({ profile });
      },
    },
    {
      method: 'DELETE',
      path: '/api/profiles/:name',
      requires: 'profiles:edit',
      async handle(req, ctx) {
        const name = req.params.name;
        if (!name) return notFound('profile');
        await ctx.store.deleteProfile(name);
        return asResponse({ ok: true });
      },
    },

    // ============ Risk map ============
    {
      method: 'GET',
      path: '/api/risks',
      requires: 'risk-map:read',
      async handle(req, ctx) {
        const risks = await ctx.store.listRisks(scope(req));
        return asResponse({ risks } satisfies { risks: RiskMap.Risk[] });
      },
    },
    {
      method: 'GET',
      path: '/api/risks/:id',
      requires: 'risk-map:read',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('risk');
        const risk = await ctx.store.loadRisk(id);
        if (!risk) return notFound('risk');
        return asResponse({ risk });
      },
    },
    {
      method: 'PUT',
      path: '/api/risks/:id',
      requires: 'risk-map:edit',
      async handle(req, ctx) {
        const risk = req.body as RiskMap.Risk;
        await ctx.store.saveRisk(risk);
        return asResponse({ risk });
      },
    },
    {
      method: 'DELETE',
      path: '/api/risks/:id',
      requires: 'risk-map:edit',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('risk');
        await ctx.store.deleteRisk(id);
        return asResponse({ ok: true });
      },
    },

    // ============ Scenarios ============
    {
      method: 'GET',
      path: '/api/scenarios',
      requires: 'packs:read',
      async handle(req, ctx) {
        const opts: { pack?: string; risk_id?: string } = {};
        if (req.params.pack) opts.pack = req.params.pack;
        if (req.params.risk_id) opts.risk_id = req.params.risk_id;
        const scenarios = await ctx.store.listScenarios(opts);
        return asResponse({ scenarios } satisfies { scenarios: Scenario.Scenario[] });
      },
    },
    {
      method: 'GET',
      path: '/api/scenarios/:id',
      requires: 'packs:read',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('scenario');
        const scenario = await ctx.store.loadScenario(id);
        if (!scenario) return notFound('scenario');
        return asResponse({ scenario });
      },
    },
    {
      method: 'PUT',
      path: '/api/scenarios/:id',
      requires: 'risk-map:edit',
      async handle(req, ctx) {
        const scenario = req.body as Scenario.Scenario;
        await ctx.store.saveScenario(scenario);
        return asResponse({ scenario });
      },
    },

    // ============ Audit ============
    {
      method: 'GET',
      path: '/api/audit',
      requires: 'audit:read',
      async handle(req, ctx) {
        const s = scope(req);
        const opts: {
          org?: string;
          project?: string;
          kind?: Event.Event['kind'];
          from?: string;
          to?: string;
          limit?: number;
        } = { limit: 500 };
        if (s.org) opts.org = s.org;
        if (s.project) opts.project = s.project;
        if (req.params.kind) opts.kind = req.params.kind as Event.Event['kind'];
        if (req.params.from) opts.from = req.params.from;
        if (req.params.to) opts.to = req.params.to;
        const events = await ctx.store.listAuditEvents(opts);
        return asResponse({ events });
      },
    },

    // ============ Cost ============
    {
      method: 'GET',
      path: '/api/cost/summary',
      requires: 'cost:read',
      async handle(req, ctx) {
        const s = requireScope(req);
        if ('status' in s) return s;
        const from = req.params.from ?? new Date(Date.now() - 30 * 86400_000).toISOString();
        const to = req.params.to ?? new Date().toISOString();
        const summary = await ctx.store.costSummary({ org: s.org, project: s.project, from, to });
        return asResponse({ summary } satisfies { summary: CostSummary.CostSummary });
      },
    },

    // ============ Queue (runner ops) ============
    {
      method: 'GET',
      path: '/api/queue',
      requires: 'runs:read',
      async handle(_req, ctx) {
        return asResponse({ jobs: ctx.queue.snapshot() });
      },
    },
    {
      method: 'GET',
      path: '/api/runner/jobs/next',
      requires: null,
      async handle(_req, ctx) {
        const next = ctx.queue.dequeue();
        return { status: next ? 200 : 204, body: next ? { job: next } : null };
      },
    },

    // ============ Notifications ============
    {
      method: 'GET',
      path: '/api/notifications',
      requires: 'audit:read',
      async handle(req, ctx) {
        const s = scope(req);
        if (!s.org) return { status: 400, body: { error: 'x-aqa-org required' } };
        const user = await ctx.authenticate(req.headers);
        const opts: {
          org: string;
          project?: string;
          unread_for?: string;
          limit: number;
        } = { org: s.org, limit: 100 };
        if (s.project) opts.project = s.project;
        if (user) opts.unread_for = user.id;
        const notifications = await ctx.store.listNotifications(opts);
        return asResponse({
          notifications,
        } satisfies { notifications: Notification.Notification[] });
      },
    },
    {
      method: 'POST',
      path: '/api/notifications/:id/read',
      requires: 'audit:read',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('notification');
        const user = await ctx.authenticate(req.headers);
        if (!user) return { status: 401, body: { error: 'unauthorized' } };
        await ctx.store.markNotificationRead(id, user.id);
        return asResponse({ ok: true });
      },
    },

    // ============ Saved views ============
    {
      method: 'GET',
      path: '/api/saved-views',
      requires: 'runs:read',
      async handle(req, ctx) {
        const s = requireScope(req);
        if ('status' in s) return s;
        const surface = req.params.surface as SavedView.SavedViewSurface | undefined;
        if (!surface) return { status: 400, body: { error: 'surface query param required' } };
        const user = await ctx.authenticate(req.headers);
        const opts: {
          org: string;
          project: string;
          surface: SavedView.SavedViewSurface;
          owner?: string;
        } = { org: s.org, project: s.project, surface };
        if (user) opts.owner = user.id;
        const views = await ctx.store.listSavedViews(opts);
        return asResponse({ views } satisfies { views: SavedView.SavedView[] });
      },
    },
    {
      method: 'POST',
      path: '/api/saved-views',
      requires: 'runs:read',
      async handle(req, ctx) {
        const view = req.body as SavedView.SavedView;
        await ctx.store.saveSavedView(view);
        return asResponse({ view }, 201);
      },
    },
    {
      method: 'DELETE',
      path: '/api/saved-views/:id',
      requires: 'runs:read',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('view');
        await ctx.store.deleteSavedView(id);
        return asResponse({ ok: true });
      },
    },

    // ============ Tokens ============
    {
      method: 'GET',
      path: '/api/tokens',
      requires: 'settings:read',
      async handle(req, ctx) {
        const s = scope(req);
        if (!s.org) return { status: 400, body: { error: 'x-aqa-org required' } };
        const user = await ctx.authenticate(req.headers);
        const opts: { org: string; owner?: string } = { org: s.org };
        if (user) opts.owner = user.id;
        const tokens = await ctx.store.listTokens(opts);
        return asResponse({ tokens } satisfies { tokens: ApiToken.ApiToken[] });
      },
    },
    {
      method: 'POST',
      path: '/api/tokens',
      requires: 'settings:edit',
      async handle(req, ctx) {
        const token = req.body as ApiToken.ApiToken;
        await ctx.store.createToken(token);
        return asResponse({ token }, 201);
      },
    },
    {
      method: 'DELETE',
      path: '/api/tokens/:id',
      requires: 'settings:edit',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('token');
        await ctx.store.revokeToken(id, new Date().toISOString());
        return asResponse({ ok: true });
      },
    },

    // ============ Tenancy ============
    {
      method: 'GET',
      path: '/api/orgs',
      requires: 'settings:read',
      async handle(_req, ctx) {
        const orgs = await ctx.store.listOrgs();
        return asResponse({ orgs } satisfies { orgs: Tenancy.Org[] });
      },
    },
    {
      method: 'GET',
      path: '/api/orgs/:org/projects',
      requires: 'settings:read',
      async handle(req, ctx) {
        const org = req.params.org;
        if (!org) return notFound('org');
        const projects = await ctx.store.listProjects(org);
        return asResponse({ projects } satisfies { projects: Tenancy.ProjectRef[] });
      },
    },
    {
      method: 'POST',
      path: '/api/orgs',
      requires: 'admin:everything',
      async handle(req, ctx) {
        const org = req.body as Tenancy.Org;
        await ctx.store.saveOrg(org);
        return asResponse({ org }, 201);
      },
    },
    {
      method: 'POST',
      path: '/api/orgs/:org/projects',
      requires: 'admin:everything',
      async handle(req, ctx) {
        const project = req.body as Tenancy.ProjectRef;
        await ctx.store.saveProject(project);
        return asResponse({ project }, 201);
      },
    },
  ];
}
