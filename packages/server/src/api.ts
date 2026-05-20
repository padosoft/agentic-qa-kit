import { Permission, rolePermissions } from '@aqa/auth';
import type { Permission as PermissionType, Role, User, allows } from '@aqa/auth';
import { runPackNew } from '@aqa/kit';
import type { PackNewErrorCode } from '@aqa/kit';
import {
  PackManifest as PackManifestSchema,
  Profile as ProfileSchema,
  RiskMap as RiskMapSchema,
  Scenario as ScenarioSchema,
} from '@aqa/schemas';
import type {
  Agent,
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
import { parse as yamlParse } from 'yaml';
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

/**
 * Format a Zod safeParse failure as a concise list of `path: message`
 * lines. The default `error.message` is the full Zod dump (multi-line
 * JSON-ish output), which is verbose and hard to read in the admin's
 * inline alert. Walking `error.issues` lets us surface just the
 * actionable bits: "applies_when.sut_type: Required", etc.
 *
 * Falls back to the original message if `issues` is empty or malformed
 * — the message is then truncated to a sane length so we don't dump a
 * 5KB Zod blob into a toast.
 */
function formatZodError(err: {
  issues?: Array<{ path: Array<string | number>; message: string }>;
  message?: string;
}): string {
  if (Array.isArray(err.issues) && err.issues.length > 0) {
    return err.issues
      .map((iss) => `${iss.path.length > 0 ? iss.path.join('.') : '<root>'}: ${iss.message}`)
      .join('; ');
  }
  return (err.message ?? 'unknown schema error').slice(0, 500);
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
        // NOTE: this v1.4 endpoint accepts a pre-parsed JSON manifest
        // and currently does NOT validate against the schema or
        // detect duplicates — `MemoryStore.installPack` silently
        // overwrites. The newer `POST /api/packs/import` (slice 4b)
        // adds full validation + conflict detection on a YAML body.
        // Consolidating both onto a shared helper (validate-then-
        // install, with `force` semantics) is tracked as a v1.7.x
        // follow-up; doing it here would change long-standing
        // behavior callers may depend on, so it's intentionally
        // out of scope for this slice. Until then, callers wanting
        // safety guarantees should prefer `/api/packs/import`.
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
      //
      // Tenancy: this endpoint deliberately writes to a single,
      // server-global `ctx.projectRoot` and ignores `x-aqa-org` /
      // `x-aqa-project` headers — unlike the other pack endpoints
      // which are scope-aware. The intent is single-tenant only: the
      // server manages exactly one on-disk project, the wizard creates
      // packs in that project's `packs/` directory, end of story.
      // A multi-tenant deployment that wants per-tenant pack scaffold
      // must front this endpoint with a per-tenant `projectRoot` (e.g.
      // by booting a separate server process per tenant, or layering a
      // routing proxy that picks the right root). Doing in-process
      // per-tenant scaffolding here would require materially more
      // design — at minimum, where to root the per-tenant directories,
      // how `aqa run`'s default discovery interacts with that layout,
      // and whether tenant isolation is enforced at the filesystem or
      // at the API layer — and is intentionally out of scope for the
      // v1.7 admin Create-pack wizard.
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
        // Slug length is delegated to runPackNew (MAX_SLUG_LEN=52) and
        // surfaces as a 400 EINVAL. We don't duplicate the cap here so
        // there's one source of truth — if MAX_SLUG_LEN ever changes,
        // the API boundary follows automatically.
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
        // Trim the required string inputs before forwarding so a caller
        // who sends `"  pack-x  "` gets the right validation outcome
        // (it's a clean slug) rather than runPackNew's "must be
        // lowercase alphanumeric" error rejecting the whitespace.
        // The admin wizard already trims; this normalizes for direct
        // API callers too.
        //
        // For optional string fields (description/author/license), trim
        // AND drop empty/whitespace-only values from the forwarded
        // payload — otherwise a request like `{"description": "   "}`
        // would write a blank `description:` line into the generated
        // pack.yaml, which is worse than just falling back to the
        // scaffolder's default ("Pack scaffolded by aqa pack new").
        function optStr(k: 'description' | 'author' | 'license'): string | undefined {
          const v = body[k];
          if (typeof v !== 'string') return undefined;
          const trimmed = v.trim();
          return trimmed === '' ? undefined : trimmed;
        }
        const description = optStr('description');
        const author = optStr('author');
        const license = optStr('license');
        const result = runPackNew({
          root: ctx.projectRoot,
          slug: body.slug.trim(),
          sutType: body.sut_type.trim(),
          ...(body.force !== undefined ? { force: body.force as boolean } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(author !== undefined ? { author } : {}),
          ...(license !== undefined ? { license } : {}),
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

    {
      // v1.7 slice 4b — admin "Import manifest" wizard:
      // accepts a YAML manifest as a string, parses + validates it
      // against `@aqa/schemas/PackManifest`, then installs into the
      // store via `installPack`. Separate from `POST /api/packs`
      // (which takes pre-parsed JSON) so the admin can hand the
      // server a raw `pack.yaml` blob without parsing client-side.
      method: 'POST',
      path: '/api/packs/import',
      requires: 'packs:install',
      async handle(req, ctx) {
        const body = (req.body ?? {}) as Record<string, unknown>;
        if (typeof body.yaml !== 'string' || body.yaml.trim() === '') {
          return asResponse(
            {
              error: 'body.yaml is required (non-empty string containing the pack manifest YAML)',
              code: 'EINVAL' satisfies PackNewErrorCode,
            },
            400,
          );
        }
        if (body.force !== undefined && typeof body.force !== 'boolean') {
          return asResponse(
            {
              error: 'force must be a boolean when provided (got non-boolean)',
              code: 'EINVAL' satisfies PackNewErrorCode,
            },
            400,
          );
        }
        let parsed: unknown;
        try {
          parsed = yamlParse(body.yaml);
        } catch (e) {
          return asResponse(
            {
              error: `yaml parse error: ${e instanceof Error ? e.message : String(e)}`,
              code: 'EINVAL' satisfies PackNewErrorCode,
            },
            400,
          );
        }
        const validated = PackManifestSchema.PackManifest.safeParse(parsed);
        if (!validated.success) {
          return asResponse(
            {
              error: `manifest failed schema validation: ${formatZodError(validated.error)}`,
              code: 'EINVAL' satisfies PackNewErrorCode,
            },
            400,
          );
        }
        const manifest = validated.data;
        const existing = await ctx.store.loadPack(manifest.name);
        if (existing && body.force !== true) {
          return asResponse(
            {
              error: `pack "${manifest.name}" already exists (currently version ${existing.version}); pass force=true to overwrite`,
              code: 'EEXIST' satisfies PackNewErrorCode,
            },
            409,
          );
        }
        try {
          await ctx.store.installPack(manifest);
        } catch (e) {
          return asResponse(
            {
              error: `installPack failed: ${e instanceof Error ? e.message : String(e)}`,
              code: 'EIO' satisfies PackNewErrorCode,
            },
            500,
          );
        }
        return asResponse({ pack: manifest }, 201);
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
      // v1.7 slice 4c.3 — Profile Clone. POST is strictly "create new"
      // semantics: schema-validate, reject if a profile with that name
      // already exists (409, mirrors POST /api/packs/scaffold), then
      // persist. PUT remains the upsert / replace-by-path-name route
      // for edits — keeping the verbs separate prevents a clone
      // operation from silently overwriting an existing profile.
      method: 'POST',
      path: '/api/profiles',
      requires: 'profiles:edit',
      async handle(req, ctx) {
        const parsed = ProfileSchema.Profile.safeParse(req.body);
        if (!parsed.success) {
          return asResponse(
            { error: `profile failed schema validation: ${formatZodError(parsed.error)}` },
            400,
          );
        }
        const profile = parsed.data;
        // Atomic check+create at the store layer — two concurrent POSTs
        // for the same name can't both observe "missing" and overwrite
        // each other. saveProfile + a prior loadProfile would race.
        const { created } = await ctx.store.createProfile(profile);
        if (!created) {
          return asResponse(
            {
              error: `profile "${profile.name}" already exists; PUT /api/profiles/${encodeURIComponent(profile.name)} to update or pick a different name`,
              code: 'EEXIST',
            },
            409,
          );
        }
        return asResponse({ profile }, 201);
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
        // The path name is the canonical identity for this route —
        // match the GET/DELETE handlers and 404 when it's missing
        // instead of letting a body-only request persist `body.name`
        // without any path identity. (Copilot review on PR #30 iter
        // 10.)
        const pathName = req.params.name;
        if (!pathName) return notFound('profile');
        // Parse the body against the Profile schema before persisting.
        // The admin UI does its own client-side validation, but the
        // server is the trust boundary — any non-UI client (curl, a
        // stale UI bundle, a custom integration) can otherwise persist
        // malformed records and break downstream code that relies on
        // the schema's invariants. (Copilot review on PR #30 iter 9.)
        const parsed = ProfileSchema.Profile.safeParse(req.body);
        if (!parsed.success) {
          return asResponse(
            { error: `profile failed schema validation: ${formatZodError(parsed.error)}` },
            400,
          );
        }
        const profile = parsed.data;
        // The route name is the canonical identity; a body that names a
        // different profile would silently create-or-replace the body's
        // name instead of the path's, which is a path-confusion class
        // of bug. Reject mismatches with a 400 instead of trusting one
        // side.
        if (profile.name !== pathName) {
          return asResponse(
            { error: `profile name mismatch: path "${pathName}" vs body "${profile.name}"` },
            400,
          );
        }
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
        // Mirrors PUT /api/profiles/:name's trust-boundary checks:
        // schema validation (UI inline validation is a UX nicety, not
        // a trust boundary), path/body id-match (so a request to
        // /risks/A can't silently upsert risk-id "B"), and 404 on
        // missing path id (matches GET/DELETE).
        const pathId = req.params.id;
        if (!pathId) return notFound('risk');
        const parsed = RiskMapSchema.Risk.safeParse(req.body);
        if (!parsed.success) {
          return asResponse(
            { error: `risk failed schema validation: ${formatZodError(parsed.error)}` },
            400,
          );
        }
        const risk = parsed.data;
        if (risk.id !== pathId) {
          return asResponse(
            { error: `risk id mismatch: path "${pathId}" vs body "${risk.id}"` },
            400,
          );
        }
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
        // DELETE is idempotent — we don't 404 on already-gone, the
        // desired end state is "no risk with this id" regardless of
        // whether one was there to begin with. The admin UI treats
        // 200 as success either way.
        await ctx.store.deleteRisk(id);
        return asResponse({ id, deleted: true });
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
      method: 'POST',
      path: '/api/scenarios',
      requires: 'risk-map:edit',
      async handle(req, ctx) {
        // Create-new semantics with atomic Store.createScenario —
        // two concurrent POSTs for the same id can't both observe
        // "missing" and overwrite each other. Mirrors POST
        // /api/profiles (slice 4c.3).
        const parsed = ScenarioSchema.Scenario.safeParse(req.body);
        if (!parsed.success) {
          return asResponse(
            { error: `scenario failed schema validation: ${formatZodError(parsed.error)}` },
            400,
          );
        }
        const scenario = parsed.data;
        const { created } = await ctx.store.createScenario(scenario);
        if (!created) {
          return asResponse(
            {
              error: `scenario "${scenario.id}" already exists; PUT /api/scenarios/${encodeURIComponent(scenario.id)} to update or pick a different id`,
              code: 'EEXIST',
            },
            409,
          );
        }
        return asResponse({ scenario }, 201);
      },
    },
    {
      method: 'PUT',
      path: '/api/scenarios/:id',
      requires: 'risk-map:edit',
      async handle(req, ctx) {
        // Trust-boundary checks (mirror PUT /api/risks/:id and PUT
        // /api/profiles/:name): missing path id → 404, body must
        // schema-parse, body.id must match path id.
        const pathId = req.params.id;
        if (!pathId) return notFound('scenario');
        const parsed = ScenarioSchema.Scenario.safeParse(req.body);
        if (!parsed.success) {
          return asResponse(
            { error: `scenario failed schema validation: ${formatZodError(parsed.error)}` },
            400,
          );
        }
        const scenario = parsed.data;
        if (scenario.id !== pathId) {
          return asResponse(
            { error: `scenario id mismatch: path "${pathId}" vs body "${scenario.id}"` },
            400,
          );
        }
        await ctx.store.saveScenario(scenario);
        return asResponse({ scenario });
      },
    },
    {
      method: 'DELETE',
      path: '/api/scenarios/:id',
      requires: 'risk-map:edit',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('scenario');
        // Idempotent — mirrors DELETE /api/risks/:id (slice 4c.4).
        // Returns { id, deleted: true } regardless of whether the row
        // was actually there, so the admin can correlate the response
        // and toast against the submitted id. (Profile delete still
        // returns the older { ok: true } shape — its admin wizard
        // doesn't need correlation since it always navigates back to
        // the profiles list.)
        await ctx.store.deleteScenario(id);
        return asResponse({ id, deleted: true });
      },
    },

    // ============ v1.7 slice 4d — Agents ============
    {
      method: 'GET',
      path: '/api/agents',
      requires: 'agents:read',
      async handle(_req, ctx) {
        const agents = await ctx.store.listAgents();
        return asResponse({ agents } satisfies { agents: Agent.Agent[] });
      },
    },
    {
      method: 'GET',
      path: '/api/agents/:id',
      requires: 'agents:read',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('agent');
        const agent = await ctx.store.loadAgent(id);
        if (!agent) return notFound('agent');
        return asResponse({ agent });
      },
    },
    {
      method: 'POST',
      path: '/api/agents/:id/install',
      requires: 'agents:edit',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('agent');
        const agent = await ctx.store.installAgent(id);
        if (!agent) return notFound('agent');
        return asResponse({ agent });
      },
    },
    {
      method: 'POST',
      path: '/api/agents/:id/uninstall',
      requires: 'agents:edit',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('agent');
        const agent = await ctx.store.uninstallAgent(id);
        if (!agent) return notFound('agent');
        return asResponse({ agent });
      },
    },

    // ============ v1.7 slice 4g — Users & Roles ============
    {
      method: 'GET',
      path: '/api/users',
      requires: 'settings:read',
      async handle(_req, ctx) {
        const users = await ctx.store.listUsers();
        return asResponse({ users });
      },
    },
    {
      // Returns the rolePermissions matrix from @aqa/auth — the admin
      // Roles page renders it as the "Action × Role" grid. Static
      // (compiled-in) so no store call needed; the route exists so
      // the admin doesn't need a build-time dep on @aqa/auth.
      method: 'GET',
      path: '/api/roles',
      requires: 'settings:read',
      async handle(_req, _ctx) {
        const roles = Object.entries(rolePermissions).map(([role, perms]) => ({
          role: role as Role,
          permissions: perms as ReadonlyArray<PermissionType>,
        }));
        // Derive the full enum from @aqa/auth at runtime (PR #42
        // Copilot iter 2) — `Permission.options` is the canonical
        // string[] from the Zod enum. Hardcoded copies drifted
        // every time the enum gained an entry.
        const all_permissions = Permission.options as ReadonlyArray<PermissionType>;
        return asResponse({ roles, all_permissions });
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
