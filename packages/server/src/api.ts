import { createHash, randomUUID } from 'node:crypto';
import { Permission, rolePermissions } from '@aqa/auth';
import type { Permission as PermissionType, Role, User, allows } from '@aqa/auth';
import { ScimProvisioner } from '@aqa/auth';
import type { ScimDirectory, ScimDirectoryUser, ScimUserResource } from '@aqa/auth';
import { verifyEventChain } from '@aqa/compliance';
import type { BudgetHaltController } from '@aqa/cost';
import { measureRiskCoverage } from '@aqa/methodology';
import { safeErrorMessage } from '@aqa/observability';
import { runPackNew } from '@aqa/pack-author';
import type { PackNewErrorCode } from '@aqa/pack-author';
import {
  type SigstoreVerificationPolicy,
  scanPack,
  verifyManifestDigest,
  verifySignature,
  verifySigstoreBundle,
  verifyTrustedManifestSignature,
} from '@aqa/pack-scanner';
import {
  Finding as FindingSchema,
  PackManifest as PackManifestSchema,
  Profile as ProfileSchema,
  RiskMap as RiskMapSchema,
  RunRequest as RunRequestSchema,
  Scenario as ScenarioSchema,
  SsoConfig as SsoConfigSchema,
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
  SsoConfig,
  Tenancy,
} from '@aqa/schemas';
import type { StoreProvider } from '@aqa/store';
import { parse as yamlParse } from 'yaml';
import {
  type ApiIdempotencyStore,
  MemoryApiIdempotencyStore,
  validateIdempotencyKey,
} from './api-idempotency.js';
import type { EventBus } from './event-bus.js';
import { IdempotencyConflictError, ResourceQuotaExceededError } from './runner-queue.js';
import {
  type RunnerAuthorizationResult,
  type RunnerQueueLike,
  matchesRunnerScopes,
} from './runner-queue.js';

export interface ApiContext {
  store: StoreProvider;
  queue: RunnerQueueLike;
  /** Optional low-latency fan-out; authoritative state remains in store/queue. */
  eventBus?: EventBus;
  /** Resolve the authenticated user from the request. */
  authenticate: (headers: Record<string, string>) => Promise<User | null>;
  /** Optional runner credential verifier for runner-only endpoints. */
  runnerAuthorize?: (headers: Record<string, string>) => Promise<RunnerAuthorizationResult>;
  /** Authorize the authenticated user for the requested org/project scope. */
  authorizeScope?: (user: User, scope: { org: string; project?: string }) => Promise<boolean>;
  /** Verify a dedicated SCIM bearer token for the requested organization. */
  scimAuthorize?: (headers: Record<string, string>, org: string) => Promise<boolean>;
  /** Optional tenant-scoped abuse limiter; return false to reject with 429. */
  scimRateLimit?: (org: string) => Promise<boolean> | boolean;
  /** Trusted Ed25519 pack keys keyed by operator-managed key_id. */
  packTrustedKeys?: Readonly<Record<string, string>>;
  /** Require every imported pack to declare a verifiable signature. Defaults true. */
  packRequireSignature?: boolean;
  /** Required policy when a pack declares a Sigstore bundle. */
  packSigstorePolicy?: SigstoreVerificationPolicy;
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
  /** Shared idempotency state for mutating API requests. */
  idempotency?: ApiIdempotencyStore;
  /** Optional durable LLM budget control plane. */
  budgetControl?: BudgetHaltController;
}

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequest {
  headers: Record<string, string>;
  body?: unknown;
  params: Record<string, string>;
  query?: Record<string, string | undefined>;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
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

function scimOrg(req: ApiRequest): string | undefined {
  const value = req.headers['x-aqa-org'] ?? req.headers['X-Aqa-Org'];
  return value?.trim() || undefined;
}

function budgetKey(req: ApiRequest): { org: string; project: string } | ApiResponse {
  const value = requireScope(req);
  return value;
}

async function authorizeScim(
  req: ApiRequest,
  ctx: ApiContext,
  org: string,
): Promise<ApiResponse | null> {
  if (ctx.scimRateLimit && !(await ctx.scimRateLimit(org)))
    return { status: 429, body: { error: 'scim_rate_limited' } };
  if (!ctx.scimAuthorize || !(await ctx.scimAuthorize(req.headers, org)))
    return { status: 401, body: { error: 'unauthorized' } };
  return null;
}

function scimResource(input: unknown): ScimUserResource | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as { userName?: unknown };
  return typeof value.userName === 'string' ? (input as ScimUserResource) : null;
}

function scimUserResource(user: ScimDirectoryUser): Record<string, unknown> {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: user.id,
    userName: user.user_name,
    displayName: user.display_name,
    active: user.active,
    emails: [{ value: user.email, primary: true }],
    roles: user.roles.map((value) => ({ value })),
    meta: { resourceType: 'User', lastModified: user.updated_at },
  };
}

function scimDirectory(ctx: ApiContext): ScimDirectory {
  return {
    async get(tenant, id) {
      const user = (await ctx.store.listUsers({ org: tenant })).find((entry) => entry.id === id);
      return user
        ? {
            id: user.id,
            user_name: user.user_name ?? user.email,
            email: user.email,
            display_name: user.display_name,
            roles: user.roles,
            active: user.status !== 'suspended',
            tenant,
            updated_at: user.last_active_at ?? new Date(0).toISOString(),
          }
        : null;
    },
    async list(tenant, filter) {
      const users = await ctx.store.listUsers({ org: tenant });
      const exact = filter?.match(/^userName\s+eq\s+"([^"]+)"$/i)?.[1];
      return users
        .filter(
          (entry) =>
            !exact || entry.user_name === exact || entry.email === exact || entry.id === exact,
        )
        .map((entry) => ({
          id: entry.id,
          user_name: entry.user_name ?? entry.email,
          email: entry.email,
          display_name: entry.display_name,
          roles: entry.roles,
          active: entry.status !== 'suspended',
          tenant,
          updated_at: entry.last_active_at ?? new Date(0).toISOString(),
        }));
    },
    async put(user) {
      await ctx.store.upsertUser(
        {
          id: user.id,
          user_name: user.user_name,
          email: user.email,
          display_name: user.display_name,
          roles: user.roles,
          status: user.active ? 'active' : 'suspended',
          last_active_at: user.updated_at,
        },
        { org: user.tenant },
      );
    },
    async remove() {
      // SCIM DELETE is deliberately a deactivation at this boundary; the
      // store has no destructive user-delete contract yet.
    },
  };
}

function validatePackForInstall(
  input: unknown,
  requireSignature: boolean,
): { ok: true; manifest: PackManifest.PackManifest } | { ok: false; response: ApiResponse } {
  const validated = PackManifestSchema.PackManifest.safeParse(input);
  if (!validated.success) {
    return {
      ok: false,
      response: asResponse(
        {
          error: `manifest failed schema validation: ${formatZodError(validated.error)}`,
          code: 'EINVAL',
        },
        400,
      ),
    };
  }
  const manifest = validated.data;
  const blockingIssues = scanPack(manifest, { requireSignature }).issues.filter(
    (issue) => issue.severity === 'critical' || issue.severity === 'high',
  );
  if (blockingIssues.length > 0) {
    return {
      ok: false,
      response: asResponse(
        {
          error: 'pack rejected by supply-chain scanner',
          code: 'EPACKSCAN',
          issues: blockingIssues,
        },
        400,
      ),
    };
  }
  return { ok: true, manifest };
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

function entityTag(value: unknown): string {
  return `"${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}"`;
}

function conditionalConflict(req: ApiRequest, current: unknown): ApiResponse | null {
  const ifMatch = req.headers['if-match'] ?? req.headers['If-Match'];
  if (!ifMatch || ifMatch === '*' || ifMatch === entityTag(current)) return null;
  return {
    status: 412,
    body: { error: 'resource changed since it was read', code: 'PRECONDITION_FAILED' },
    headers: { ETag: entityTag(current) },
  };
}

function notFound(what: string): ApiResponse {
  return { status: 404, body: { error: `${what} not found` } };
}

function cryptoUuid(): string {
  return randomUUID();
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, item]),
    );
  });
}

async function publishApiEvent(
  ctx: ApiContext,
  req: ApiRequest,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!ctx.eventBus) return;
  const tenant = scope(req);
  try {
    await ctx.eventBus.publish({
      id: cryptoUuid(),
      type,
      occurred_at: new Date().toISOString(),
      ...(tenant.org ? { org: tenant.org } : {}),
      ...(tenant.project ? { project: tenant.project } : {}),
      data,
    });
  } catch {
    // State is authoritative; consumers reconcile after a notification gap.
  }
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
  const fallbackIdempotency = new MemoryApiIdempotencyStore();
  const routes: ApiHandler[] = [
    // ============ Runs ============
    {
      method: 'GET',
      path: '/api/events/stream',
      requires: 'runs:read',
      async handle() {
        // The Node adapter upgrades this route to a real SSE response. Other
        // adapters must implement the same authenticated stream contract.
        return {
          status: 501,
          body: { error: 'live event streaming is not supported by this adapter' },
        };
      },
    },
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
        const runs = await ctx.store.listRuns({ org: s.org, project: s.project, limit: 100 });
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
        if (!run || run.org !== s.org || run.project !== s.project) return notFound('run');
        return asResponse({ run } satisfies { run: Run.Run });
      },
    },
    {
      method: 'POST',
      path: '/api/runs',
      requires: 'runs:create',
      async handle(req, ctx) {
        const s = requireScope(req);
        if ('status' in s) return s;
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
          return { status: 400, body: { error: 'run request body must be an object' } };
        }
        const parsedRequest = RunRequestSchema.RunRequest.safeParse(req.body);
        if (!parsedRequest.success) {
          return asResponse(
            {
              error: `run request failed schema validation: ${formatZodError(parsedRequest.error)}`,
            },
            400,
          );
        }
        const payload = {
          ...parsedRequest.data,
          org: s.org,
          project: s.project,
        };
        const rawKey = req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'];
        const idempotencyKey = rawKey?.trim();
        if (
          idempotencyKey !== undefined &&
          (idempotencyKey.length === 0 || idempotencyKey.length > 200)
        ) {
          return { status: 400, body: { error: 'Idempotency-Key must be 1..200 characters' } };
        }
        try {
          const job = await ctx.queue.enqueue({
            id: cryptoUuid(),
            payload,
            enqueued_at: new Date().toISOString(),
            ...(parsedRequest.data.priority !== undefined
              ? { priority: parsedRequest.data.priority }
              : {}),
            ...(idempotencyKey
              ? {
                  idempotency_key: `${s.org}/${s.project}:${idempotencyKey}`,
                  idempotency_fingerprint: canonicalJson(payload),
                }
              : {}),
          });
          await publishApiEvent(ctx, req, 'run.requested', { job_id: job.id });
          return asResponse({ job }, 202);
        } catch (error) {
          if (error instanceof IdempotencyConflictError) {
            return { status: 409, body: { error: error.message, code: 'IDEMPOTENCY_CONFLICT' } };
          }
          if (error instanceof ResourceQuotaExceededError) {
            return {
              status: 429,
              body: {
                error: error.message,
                code: 'RESOURCE_QUOTA_EXCEEDED',
                quota: error.quota,
                limit: error.limit,
                current: error.current,
                requested: error.requested,
              },
            };
          }
          throw error;
        }
      },
    },
    {
      method: 'POST',
      path: '/api/runs/:id/cancel',
      requires: 'runs:create',
      async handle(req, ctx) {
        const id = req.params.id;
        if (!id) return notFound('run job');
        const s = requireScope(req);
        if ('status' in s) return s;
        const body = (req.body ?? {}) as { reason?: unknown };
        if (body.reason !== undefined && (typeof body.reason !== 'string' || !body.reason.trim())) {
          return {
            status: 400,
            body: { error: 'reason must be a non-empty string when provided' },
          };
        }
        const cancelled = await ctx.queue.cancel(
          id,
          typeof body.reason === 'string' ? body.reason : 'cancelled by operator',
          s,
        );
        if (!cancelled) return notFound('run job');
        await publishApiEvent(ctx, req, 'run.cancelled', { job_id: id });
        return asResponse({ id, cancelled: true });
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
        const s = requireScope(req);
        if ('status' in s) return s;
        const filter: { run_id?: string } = {};
        if (req.params.run_id) filter.run_id = req.params.run_id;
        const candidates = await ctx.store.listFindings(filter);
        const findings = [];
        for (const finding of candidates) {
          const run = await ctx.store.loadRun(finding.run_id);
          if (run?.org === s.org && run.project === s.project) findings.push(finding);
        }
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
        if (!run || run.org !== s.org || run.project !== s.project) return notFound('finding');
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
        const s = requireScope(req);
        if ('status' in s) return s;
        const existing = await ctx.store.loadFinding(id);
        if (!existing) return notFound('finding');
        const run = await ctx.store.loadRun(existing.run_id);
        if (!run || run.org !== s.org || run.project !== s.project) return notFound('finding');
        const body = req.body as
          | { status?: unknown; reason?: unknown; duplicate_of?: unknown }
          | undefined;
        if (typeof body?.status !== 'string' || typeof body.reason !== 'string' || !body.reason) {
          return { status: 400, body: { error: 'status + reason required' } };
        }
        const candidate = {
          ...existing,
          status: body.status,
          ...(body.duplicate_of !== undefined ? { duplicate_of: body.duplicate_of } : {}),
        };
        const parsed = FindingSchema.Finding.safeParse(candidate);
        if (!parsed.success) {
          return { status: 400, body: { error: formatZodError(parsed.error) } };
        }
        let transitioned: Awaited<ReturnType<StoreProvider['transitionFindingStatus']>>;
        try {
          transitioned = await ctx.store.transitionFindingStatus(
            id,
            parsed.data.status,
            user.id,
            body.reason,
          );
        } catch (error) {
          if (error instanceof Error && error.name === 'InvalidFindingTransitionError') {
            return { status: 409, body: { error: error.message, code: 'INVALID_TRANSITION' } };
          }
          throw error;
        }
        if (!transitioned) return notFound('finding');
        await publishApiEvent(ctx, req, 'finding.status_changed', {
          finding_id: transitioned.finding.id,
          status: transitioned.finding.status,
        });
        return asResponse({ finding: transitioned.finding });
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
        const pack = await ctx.store.loadPack(slug, scope(req));
        if (!pack) return notFound('pack');
        return asResponse({ pack });
      },
    },
    {
      method: 'POST',
      path: '/api/packs',
      requires: 'packs:install',
      async handle(req, ctx) {
        const body = (req.body ?? {}) as Record<string, unknown>;
        if (body.force !== undefined && typeof body.force !== 'boolean') {
          return asResponse(
            { error: 'force must be a boolean when provided', code: 'EINVAL' },
            400,
          );
        }
        const checked = validatePackForInstall(
          body.manifest ?? req.body,
          ctx.packRequireSignature ?? true,
        );
        if (!checked.ok) return checked.response;
        const manifest = checked.manifest;
        if (manifest.signing) {
          const signature = verifyManifestDigest(manifest);
          if (!signature.ok) {
            return asResponse(
              { error: `pack signature invalid: ${signature.reason}`, code: 'ESIGNATURE' },
              400,
            );
          }
          if (ctx.packTrustedKeys) {
            const trusted = verifyTrustedManifestSignature(manifest, ctx.packTrustedKeys);
            if (!trusted.ok)
              return asResponse(
                { error: `pack trust verification failed: ${trusted.reason}`, code: 'ESIGNATURE' },
                400,
              );
          }
          if (manifest.signing.sigstore_bundle) {
            if (!ctx.packSigstorePolicy)
              return asResponse(
                {
                  error: 'Sigstore bundle requires an operator verification policy',
                  code: 'ESIGNATURE',
                },
                400,
              );
            const sigstore = await verifySigstoreBundle(manifest, ctx.packSigstorePolicy);
            if (!sigstore.ok)
              return asResponse(
                { error: `Sigstore verification failed: ${sigstore.reason}`, code: 'ESIGNATURE' },
                400,
              );
          }
        }
        const existing = await ctx.store.loadPack(manifest.name, scope(req));
        if (existing && body.force !== true) {
          return asResponse(
            {
              error: `pack "${manifest.name}" already exists; pass force=true to overwrite`,
              code: 'EEXIST',
            },
            409,
          );
        }
        await ctx.store.installPack(manifest, scope(req));
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
        await ctx.store.uninstallPack(slug, scope(req));
        return asResponse({ ok: true });
      },
    },
    {
      // v1.7 slice 3 — scaffold a new pack on disk for the Admin
      // "Create pack" wizard. Delegates to `runPackNew` from
      // `@aqa/pack-author` (the same code path the kit's `aqa pack new`
      // CLI calls through its re-export shim) so the two UIs stay in
      // lockstep on validation, atomic --force, etc.
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
        const scan = scanPack(manifest, { requireSignature: ctx.packRequireSignature ?? true });
        const blockingIssues = scan.issues.filter(
          (issue) => issue.severity === 'critical' || issue.severity === 'high',
        );
        if (blockingIssues.length > 0) {
          return asResponse(
            {
              error: 'pack rejected by supply-chain scanner',
              code: 'EPACKSCAN',
              issues: blockingIssues,
            },
            400,
          );
        }
        if (manifest.signing) {
          const signature = manifest.signing.ed25519_signature
            ? verifyManifestDigest(manifest)
            : verifySignature(manifest, body.yaml);
          if (!signature.ok) {
            return asResponse(
              { error: `pack signature invalid: ${signature.reason}`, code: 'ESIGNATURE' },
              400,
            );
          }
          if (ctx.packTrustedKeys) {
            const trusted = verifyTrustedManifestSignature(manifest, ctx.packTrustedKeys);
            if (!trusted.ok)
              return asResponse(
                { error: `pack trust verification failed: ${trusted.reason}`, code: 'ESIGNATURE' },
                400,
              );
          }
          if (manifest.signing.sigstore_bundle) {
            if (!ctx.packSigstorePolicy)
              return asResponse(
                {
                  error: 'Sigstore bundle requires an operator verification policy',
                  code: 'ESIGNATURE',
                },
                400,
              );
            const sigstore = await verifySigstoreBundle(manifest, ctx.packSigstorePolicy);
            if (!sigstore.ok)
              return asResponse(
                { error: `Sigstore verification failed: ${sigstore.reason}`, code: 'ESIGNATURE' },
                400,
              );
          }
        }
        const existing = await ctx.store.loadPack(manifest.name, scope(req));
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
          await ctx.store.installPack(manifest, scope(req));
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
        const { created } = await ctx.store.createProfile(profile, scope(req));
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
        const profile = await ctx.store.loadProfile(name, scope(req));
        if (!profile) return notFound('profile');
        return { ...asResponse({ profile }), headers: { ETag: entityTag(profile) } };
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
        const existing = await ctx.store.loadProfile(pathName, scope(req));
        if (existing) {
          const conflict = conditionalConflict(req, existing);
          if (conflict) return conflict;
        }
        await ctx.store.saveProfile(profile, scope(req));
        return { ...asResponse({ profile }), headers: { ETag: entityTag(profile) } };
      },
    },
    {
      method: 'DELETE',
      path: '/api/profiles/:name',
      requires: 'profiles:edit',
      async handle(req, ctx) {
        const name = req.params.name;
        if (!name) return notFound('profile');
        await ctx.store.deleteProfile(name, scope(req));
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
        const risk = await ctx.store.loadRisk(id, scope(req));
        if (!risk) return notFound('risk');
        return { ...asResponse({ risk }), headers: { ETag: entityTag(risk) } };
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
        const existing = await ctx.store.loadRisk(pathId, scope(req));
        if (existing) {
          const conflict = conditionalConflict(req, existing);
          if (conflict) return conflict;
        }
        await ctx.store.saveRisk(risk, scope(req));
        return { ...asResponse({ risk }), headers: { ETag: entityTag(risk) } };
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
        await ctx.store.deleteRisk(id, scope(req));
        return asResponse({ id, deleted: true });
      },
    },
    {
      method: 'GET',
      path: '/api/risk-coverage',
      requires: 'risk-map:read',
      async handle(req, ctx) {
        const s = requireScope(req);
        if ('status' in s) return s;
        const risks = await ctx.store.listRisks({ org: s.org, project: s.project });
        if (risks.length === 0)
          return asResponse({ coverage: [], generated_at: new Date().toISOString() });
        const scenarios = await ctx.store.listScenarios({ org: s.org, project: s.project });
        const runs = await ctx.store.listRuns({ org: s.org, project: s.project, limit: 1_000 });
        const observations = [];
        for (const run of runs) {
          const events = await ctx.store.listEvents(run.id);
          const chain = verifyEventChain(events);
          if (!chain.ok) {
            return asResponse(
              {
                error: 'run audit chain integrity verification failed',
                code: 'AUDIT_CHAIN_INVALID',
              },
              500,
            );
          }
          const byScenario = new Map<string, typeof events>();
          for (const event of events) {
            if (event.kind !== 'oracle_evaluated' || !event.scenario_id) continue;
            const bucket = byScenario.get(event.scenario_id) ?? [];
            bucket.push(event);
            byScenario.set(event.scenario_id, bucket);
          }
          for (const [scenarioId, oracleEvents] of byScenario) {
            const scenario = scenarios.find((candidate) => candidate.id === scenarioId);
            if (!scenario || oracleEvents.length < scenario.oracles.length) continue;
            const passed = oracleEvents.every((event) => event.payload.passed === true);
            const replay = events.some(
              (event) =>
                event.kind === 'replay_finished' &&
                event.scenario_id === scenarioId &&
                event.payload.deterministic === true,
            );
            observations.push({
              scenario_id: scenarioId,
              executed_at: run.finished_at ?? run.started_at,
              passed,
              deterministic_replay: replay,
            });
          }
        }
        const coverage = measureRiskCoverage({
          risk_map: { schema_version: '1', project: s.project, risks },
          scenarios,
          runs: observations,
        });
        return asResponse({ coverage, generated_at: new Date().toISOString() });
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
        const scenarios = await ctx.store.listScenarios({ ...opts, ...scope(req) });
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
        const scenario = await ctx.store.loadScenario(id, scope(req));
        if (!scenario) return notFound('scenario');
        return { ...asResponse({ scenario }), headers: { ETag: entityTag(scenario) } };
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
        const { created } = await ctx.store.createScenario(scenario, scope(req));
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
        const existing = await ctx.store.loadScenario(pathId, scope(req));
        if (existing) {
          const conflict = conditionalConflict(req, existing);
          if (conflict) return conflict;
        }
        await ctx.store.saveScenario(scenario, scope(req));
        return { ...asResponse({ scenario }), headers: { ETag: entityTag(scenario) } };
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
        await ctx.store.deleteScenario(id, scope(req));
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
      async handle(req, ctx) {
        const requested = scope(req);
        const users = await ctx.store.listUsers(
          requested.org || requested.project ? requested : undefined,
        );
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
    {
      // v1.7 slice 4h — SSO live config for the Admin SSO page.
      // The secret never leaves the server; only `client_secret_set`
      // is exposed for write-once UI affordance.
      method: 'GET',
      path: '/api/sso/config',
      requires: 'settings:read',
      async handle(_req, ctx) {
        const config = await ctx.store.loadSsoConfig();
        if (!config) return asResponse({ config: null } satisfies { config: null });
        const parsed = SsoConfigSchema.SsoConfig.safeParse(config);
        if (!parsed.success) {
          return {
            status: 500,
            body: { error: `sso config failed schema validation: ${formatZodError(parsed.error)}` },
          };
        }
        return asResponse({ config: parsed.data } satisfies { config: SsoConfig.SsoConfig | null });
      },
    },
    {
      method: 'PUT',
      path: '/api/sso/config',
      requires: 'settings:edit',
      async handle(req, ctx) {
        const parsed = SsoConfigSchema.SsoConfig.safeParse(req.body);
        if (!parsed.success) {
          return asResponse(
            { error: `sso config failed schema validation: ${formatZodError(parsed.error)}` },
            400,
          );
        }
        await ctx.store.saveSsoConfig(parsed.data);
        return asResponse({ config: parsed.data } satisfies { config: SsoConfig.SsoConfig });
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
    {
      method: 'GET',
      path: '/api/cost/halt',
      requires: 'cost:read',
      async handle(req, ctx) {
        const s = budgetKey(req);
        if ('status' in s) return s;
        if (!ctx.budgetControl)
          return asResponse({ error: 'durable budget control is not configured' }, 503);
        const reason = await ctx.budgetControl.getHaltReason(`${s.org}/${s.project}`);
        return asResponse({ halted: reason !== null, ...(reason ? { reason } : {}) });
      },
    },
    {
      method: 'POST',
      path: '/api/cost/halt',
      requires: 'cost:edit',
      async handle(req, ctx) {
        const s = budgetKey(req);
        if ('status' in s) return s;
        if (!ctx.budgetControl)
          return asResponse({ error: 'durable budget control is not configured' }, 503);
        const body = req.body as { reason?: unknown } | undefined;
        if (typeof body?.reason !== 'string' || !body.reason.trim())
          return asResponse({ error: 'reason is required' }, 400);
        await ctx.budgetControl.halt(`${s.org}/${s.project}`, body.reason);
        return asResponse({ halted: true, reason: body.reason.trim().slice(0, 200) }, 202);
      },
    },

    // ============ Queue (runner ops) ============
    {
      method: 'GET',
      path: '/api/queue',
      requires: 'runs:read',
      async handle(_req, ctx) {
        return asResponse({ jobs: await ctx.queue.snapshot() });
      },
    },
    {
      method: 'GET',
      path: '/api/runner/jobs/next',
      requires: null,
      async handle(req, ctx) {
        const authorization = ctx.runnerAuthorize ? await ctx.runnerAuthorize(req.headers) : true;
        if (authorization === false) {
          return { status: 401, body: { error: 'runner unauthorized' } };
        }
        const scopes = authorization === true ? undefined : authorization.scopes;
        const next = await ctx.queue.dequeue(undefined, scopes);
        return { status: next ? 200 : 204, body: next ? { job: next } : null };
      },
    },
    {
      method: 'POST',
      path: '/api/runner/jobs/:id/ack',
      requires: null,
      async handle(req, ctx) {
        const authorization = ctx.runnerAuthorize ? await ctx.runnerAuthorize(req.headers) : true;
        if (authorization === false) {
          return { status: 401, body: { error: 'runner unauthorized' } };
        }
        const id = req.params.id;
        const body = (req.body ?? {}) as { lease_token?: unknown };
        if (!id || typeof body.lease_token !== 'string' || !body.lease_token) {
          return { status: 400, body: { error: 'job id and lease_token are required' } };
        }
        const job = await ctx.queue.get(id);
        if (
          authorization !== true &&
          (!job || !matchesRunnerScopes(job.payload, authorization.scopes))
        )
          return { status: 404, body: { error: 'job not found' } };
        const acknowledged = await ctx.queue.ack(id, body.lease_token);
        return asResponse({ acknowledged }, acknowledged ? 200 : 409);
      },
    },
    {
      method: 'POST',
      path: '/api/runner/jobs/:id/fail',
      requires: null,
      async handle(req, ctx) {
        const authorization = ctx.runnerAuthorize ? await ctx.runnerAuthorize(req.headers) : true;
        if (authorization === false) {
          return { status: 401, body: { error: 'runner unauthorized' } };
        }
        const id = req.params.id;
        const body = (req.body ?? {}) as { lease_token?: unknown; reason?: unknown };
        if (
          !id ||
          typeof body.lease_token !== 'string' ||
          !body.lease_token ||
          typeof body.reason !== 'string' ||
          !body.reason.trim()
        ) {
          return { status: 400, body: { error: 'job id, lease_token and reason are required' } };
        }
        const job = await ctx.queue.get(id);
        if (
          authorization !== true &&
          (!job || !matchesRunnerScopes(job.payload, authorization.scopes))
        )
          return { status: 404, body: { error: 'job not found' } };
        const failed = await ctx.queue.fail(id, body.lease_token, body.reason);
        return asResponse({ failed }, failed ? 200 : 409);
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
      path: '/scim/v2/Users',
      requires: null,
      async handle(req, ctx) {
        const org = scimOrg(req);
        if (!org) return asResponse({ error: 'SCIM authorization required' }, 401);
        const denied = await authorizeScim(req, ctx, org);
        if (denied) return asResponse(denied.body, denied.status);
        const directory = scimDirectory(ctx);
        const query = req.query ?? {};
        const startIndex = Math.max(1, Number.parseInt(query.startIndex ?? '1', 10) || 1);
        const count = Math.max(0, Number.parseInt(query.count ?? '0', 10) || 0);
        const allUsers = await new ScimProvisioner(directory, org).list(query.filter);
        const pageStart = startIndex - 1;
        const users =
          count > 0 ? allUsers.slice(pageStart, pageStart + count) : allUsers.slice(pageStart);
        return asResponse({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: allUsers.length,
          startIndex,
          itemsPerPage: users.length,
          Resources: users.map(scimUserResource),
        });
      },
    },
    {
      method: 'POST',
      path: '/scim/v2/Users',
      requires: null,
      async handle(req, ctx) {
        const org = scimOrg(req);
        if (!org) return asResponse({ error: 'SCIM authorization required' }, 401);
        const denied = await authorizeScim(req, ctx, org);
        if (denied) return asResponse(denied.body, denied.status);
        const resource = scimResource(req.body);
        if (!resource) return asResponse({ error: 'SCIM userName is required' }, 400);
        try {
          const user = await new ScimProvisioner(scimDirectory(ctx), org).create(resource);
          return asResponse(scimUserResource(user), 201);
        } catch (error) {
          return asResponse({ error: safeErrorMessage(error, 'invalid commerce request') }, 400);
        }
      },
    },
    {
      method: 'GET',
      path: '/scim/v2/Users/:id',
      requires: null,
      async handle(req, ctx) {
        const org = scimOrg(req);
        if (!org) return asResponse({ error: 'SCIM authorization required' }, 401);
        const denied = await authorizeScim(req, ctx, org);
        if (denied) return asResponse(denied.body, denied.status);
        try {
          const user = await new ScimProvisioner(scimDirectory(ctx), org).get(req.params.id ?? '');
          return asResponse(scimUserResource(user));
        } catch {
          return asResponse({ error: 'SCIM resource not found' }, 404);
        }
      },
    },
    {
      method: 'PUT',
      path: '/scim/v2/Users/:id',
      requires: null,
      async handle(req, ctx) {
        const org = scimOrg(req);
        if (!org) return asResponse({ error: 'SCIM authorization required' }, 401);
        const denied = await authorizeScim(req, ctx, org);
        if (denied) return asResponse(denied.body, denied.status);
        const resource = scimResource(req.body);
        if (!resource) return asResponse({ error: 'SCIM userName is required' }, 400);
        try {
          const user = await new ScimProvisioner(scimDirectory(ctx), org).replace(
            req.params.id ?? '',
            resource,
          );
          return asResponse(scimUserResource(user));
        } catch (error) {
          return asResponse({ error: safeErrorMessage(error, 'invalid commerce request') }, 400);
        }
      },
    },
    {
      method: 'PATCH',
      path: '/scim/v2/Users/:id',
      requires: null,
      async handle(req, ctx) {
        const org = scimOrg(req);
        if (!org) return asResponse({ error: 'SCIM authorization required' }, 401);
        const denied = await authorizeScim(req, ctx, org);
        if (denied) return asResponse(denied.body, denied.status);
        const operations = (req.body as { Operations?: unknown })?.Operations;
        if (!Array.isArray(operations))
          return asResponse({ error: 'SCIM Operations is required' }, 400);
        try {
          const user = await new ScimProvisioner(scimDirectory(ctx), org).patch(
            req.params.id ?? '',
            operations as never,
          );
          return asResponse(scimUserResource(user));
        } catch (error) {
          return asResponse({ error: safeErrorMessage(error, 'invalid commerce request') }, 400);
        }
      },
    },
    {
      method: 'DELETE',
      path: '/scim/v2/Users/:id',
      requires: null,
      async handle(req, ctx) {
        const org = scimOrg(req);
        if (!org) return asResponse({ error: 'SCIM authorization required' }, 401);
        const denied = await authorizeScim(req, ctx, org);
        if (denied) return asResponse(denied.body, denied.status);
        try {
          await new ScimProvisioner(scimDirectory(ctx), org).deactivate(req.params.id ?? '');
          return asResponse(null, 204);
        } catch {
          return asResponse({ error: 'SCIM resource not found' }, 404);
        }
      },
    },

    // ============ Tenancy ============
    {
      method: 'POST',
      path: '/api/admin/migrate-legacy-configuration',
      requires: 'admin:everything',
      async handle(req, ctx) {
        const destination = scope(req);
        if (!destination.org && !destination.project)
          return asResponse(
            { error: 'x-aqa-org or x-aqa-project is required for legacy migration' },
            400,
          );
        const result = await ctx.store.migrateLegacyConfiguration(destination);
        return asResponse(result);
      },
    },
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
  return routes.map((route) => {
    if (route.method === 'GET') return route;
    const handler = route.handle;
    return {
      ...route,
      async handle(req, ctx) {
        let key: string | undefined;
        try {
          key = validateIdempotencyKey(
            req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'],
          );
        } catch (error) {
          return {
            status: 400,
            body: { error: error instanceof Error ? error.message : 'invalid idempotency key' },
          };
        }
        if (!key) return handler(req, ctx);
        const tenant = `${req.headers['x-aqa-org'] ?? req.headers['X-Aqa-Org'] ?? ''}/${req.headers['x-aqa-project'] ?? req.headers['X-Aqa-Project'] ?? ''}`;
        const fingerprint = canonicalJson({
          method: route.method,
          path: route.path,
          params: req.params,
          body: req.body,
          if_match: req.headers['if-match'] ?? req.headers['If-Match'],
        });
        return (ctx.idempotency ?? fallbackIdempotency).execute(
          { scope: `${tenant}:${route.method}:${route.path}`, key, fingerprint },
          () => handler(req, ctx),
        );
      },
    };
  });
}
