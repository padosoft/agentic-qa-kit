import { randomUUID } from 'node:crypto';
import { RunRequest as RunRequestSchema } from '@aqa/schemas';
import type { ApiContext } from './api.js';
import { IdempotencyConflictError, ResourceQuotaExceededError } from './runner-queue.js';

/**
 * Transport-neutral MCP control surface for AQA.
 *
 * The HTTP transport below deliberately supports the request/response subset
 * of streamable HTTP. SSE is not needed by the current control surface, which
 * has no unsolicited server notifications; hosts can still mount the handler
 * behind their own framework or gateway.
 */

export const AQA_MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18'] as const;
export type AqaMcpProtocolVersion = (typeof AQA_MCP_PROTOCOL_VERSIONS)[number] | (string & {});

export type McpPermission = 'runs:read' | 'runs:create';

export interface McpPrincipal {
  id: string;
  org: string;
  project: string;
  permissions: readonly McpPermission[];
}

export interface McpRunSelector {
  run_id: string;
  org: string;
  project: string;
}

export interface McpRunPlan {
  profile: string;
  org: string;
  project: string;
  accepted: boolean;
  execution_mode: 'orchestrator' | 'agent';
  side_effects: 'none';
  warnings: readonly string[];
}

export interface McpRunStatus {
  run_id: string;
  status: 'queued' | 'in_flight' | 'done' | 'failed' | 'cancelled' | 'unknown';
}

export interface McpEvidenceSummary {
  run_id: string;
  event_count: number;
  finding_count: number;
  artifact_refs: readonly string[];
  truncated: boolean;
}

/** Host-owned implementation; it must preserve REST API tenant semantics. */
export interface McpRunPort {
  plan(input: { profile: string; org: string; project: string }): Promise<McpRunPlan>;
  start(input: {
    profile: string;
    org: string;
    project: string;
    idempotency_key: string;
  }): Promise<McpRunStatus>;
  status(input: McpRunSelector): Promise<McpRunStatus | null>;
  cancel(input: McpRunSelector & { reason: string }): Promise<boolean>;
  evidence(input: McpRunSelector): Promise<McpEvidenceSummary | null>;
}

function queuedStatus(status: string): McpRunStatus['status'] {
  switch (status) {
    case 'queued':
    case 'in_flight':
    case 'done':
    case 'failed':
    case 'cancelled':
      return status;
    default:
      return 'unknown';
  }
}

/**
 * Bind MCP to the same queue/store used by the REST control plane.
 * Authentication happens in the transport; this adapter receives only the
 * already-authenticated principal-derived scope from `AqaMcpServer`.
 */
export function createMcpRunPort(ctx: ApiContext): McpRunPort {
  return {
    async plan(input) {
      const profile = await ctx.store.loadProfile(input.profile, input);
      if (!profile) {
        return {
          ...input,
          accepted: false,
          execution_mode: 'orchestrator',
          side_effects: 'none',
          warnings: ['profile not found in the requested tenant project'],
        };
      }
      const warnings =
        profile.execution_mode === 'agent'
          ? ['agent execution requires a host-owned agent driver']
          : [];
      return {
        ...input,
        accepted: warnings.length === 0,
        execution_mode: profile.execution_mode,
        side_effects: 'none',
        warnings,
      };
    },
    async start(input) {
      const plan = await this.plan(input);
      if (!plan.accepted) throw new Error(plan.warnings[0] ?? 'run plan rejected');
      const profileRequest = RunRequestSchema.RunRequest.safeParse({ profile: input.profile });
      if (!profileRequest.success) throw new Error('run request failed schema validation');
      try {
        const job = await ctx.queue.enqueue({
          id: randomUUID(),
          payload: { ...profileRequest.data, org: input.org, project: input.project },
          enqueued_at: new Date().toISOString(),
          idempotency_key: `${input.org}/${input.project}:${input.idempotency_key}`,
          idempotency_fingerprint: JSON.stringify(profileRequest.data),
        });
        return { run_id: job.id, status: queuedStatus(job.status) };
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new Error('idempotency key conflict');
        if (error instanceof ResourceQuotaExceededError) throw new Error('run quota exceeded');
        throw error;
      }
    },
    async status(input) {
      const job = await ctx.queue.get(input.run_id);
      if (!job || job.payload.org !== input.org || job.payload.project !== input.project)
        return null;
      return { run_id: job.id, status: queuedStatus(job.status) };
    },
    async cancel(input) {
      return ctx.queue.cancel(input.run_id, input.reason, input);
    },
    async evidence(input) {
      const run = await ctx.store.loadRun(input.run_id);
      if (!run || run.org !== input.org || run.project !== input.project) return null;
      const [events, findings] = await Promise.all([
        ctx.store.listEvents(input.run_id),
        ctx.store.listFindings({ run_id: input.run_id, limit: 100 }),
      ]);
      return {
        run_id: input.run_id,
        event_count: events.length,
        finding_count: findings.length,
        artifact_refs: ['events.jsonl'],
        truncated: events.length > 100 || findings.length >= 100,
      };
    },
  };
}

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'aqa_plan_run',
    description: 'Validate a run request without enqueueing work or causing side effects.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['profile'],
      properties: { profile: { type: 'string', minLength: 1, maxLength: 100 } },
    },
  },
  {
    name: 'aqa_start_run',
    description: 'Enqueue one tenant-scoped QA run with an idempotency key.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['profile', 'idempotency_key'],
      properties: {
        profile: { type: 'string', minLength: 1, maxLength: 100 },
        idempotency_key: { type: 'string', minLength: 1, maxLength: 200 },
      },
    },
  },
  {
    name: 'aqa_get_run',
    description: 'Read bounded status for a run in the authenticated tenant.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['run_id'],
      properties: { run_id: { type: 'string', minLength: 1, maxLength: 200 } },
    },
  },
  {
    name: 'aqa_cancel_run',
    description: 'Cancel a queued or running tenant-scoped QA run.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['run_id'],
      properties: {
        run_id: { type: 'string', minLength: 1, maxLength: 200 },
        reason: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
  },
  {
    name: 'aqa_read_evidence',
    description: 'Read bounded metadata about run evidence, never raw secrets or payloads.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['run_id'],
      properties: { run_id: { type: 'string', minLength: 1, maxLength: 200 } },
    },
  },
];

const PERMISSION_BY_TOOL: Record<string, McpPermission> = {
  aqa_plan_run: 'runs:create',
  aqa_start_run: 'runs:create',
  aqa_get_run: 'runs:read',
  aqa_cancel_run: 'runs:create',
  aqa_read_evidence: 'runs:read',
};

const MCP_ERRORS = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  notInitialized: -32002,
  unauthorized: -32003,
  failed: -32004,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max)
    throw new Error(`${field} must be a non-empty string of at most ${max} characters`);
  return value;
}

function rpcError(id: string | number | null, code: number, message: string): McpJsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function requestId(request: McpJsonRpcRequest): string | number | null {
  return request.id === undefined ? null : request.id;
}

/** One instance should be scoped to one authenticated MCP connection. */
export class AqaMcpServer {
  private initialized = false;
  private negotiatedVersion: string | undefined;
  private readonly supportedVersions: readonly string[];
  private readonly port: McpRunPort;

  constructor(port: McpRunPort, opts: { supported_versions?: readonly string[] } = {}) {
    this.port = port;
    this.supportedVersions = [...(opts.supported_versions ?? AQA_MCP_PROTOCOL_VERSIONS)];
    if (this.supportedVersions.length === 0)
      throw new Error('MCP needs one supported protocol version');
  }

  async handle(
    request: unknown,
    principal: McpPrincipal | null,
  ): Promise<McpJsonRpcResponse | null> {
    if (!isRecord(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string')
      return rpcError(null, MCP_ERRORS.invalidRequest, 'invalid JSON-RPC request');
    const normalized = request as unknown as McpJsonRpcRequest;
    const id = requestId(normalized);
    if (normalized.method === 'notifications/initialized') return null;
    if (normalized.method === 'initialize') return this.initialize(normalized);
    if (!this.initialized)
      return rpcError(id, MCP_ERRORS.notInitialized, 'MCP session is not initialized');
    if (normalized.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    if (normalized.method !== 'tools/call')
      return rpcError(id, MCP_ERRORS.methodNotFound, 'method is not supported');
    if (!principal || !principal.id || !principal.org || !principal.project)
      return rpcError(id, MCP_ERRORS.unauthorized, 'authenticated tenant principal is required');
    try {
      const result = await this.callTool(normalized.params, principal);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP tool failed';
      const code = message === 'forbidden' ? MCP_ERRORS.unauthorized : MCP_ERRORS.failed;
      return rpcError(
        id,
        code,
        code === MCP_ERRORS.unauthorized ? 'forbidden' : message.slice(0, 300),
      );
    }
  }

  private initialize(request: McpJsonRpcRequest): McpJsonRpcResponse {
    const params = isRecord(request.params) ? request.params : {};
    const requested =
      typeof params.protocolVersion === 'string' ? params.protocolVersion : undefined;
    const version =
      requested && this.supportedVersions.includes(requested)
        ? requested
        : this.supportedVersions[0];
    if (!version || (requested !== undefined && version !== requested))
      return rpcError(
        requestId(request),
        MCP_ERRORS.invalidParams,
        'unsupported MCP protocol version',
      );
    this.initialized = true;
    this.negotiatedVersion = version;
    return {
      jsonrpc: '2.0',
      id: requestId(request),
      result: {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agentic-qa-kit', version: '1' },
      },
    };
  }

  private async callTool(params: unknown, principal: McpPrincipal): Promise<unknown> {
    if (!isRecord(params)) throw new Error('tools/call params must be an object');
    const name = boundedString(params.name, 'tool name', 100);
    const permission = PERMISSION_BY_TOOL[name];
    if (!permission || !principal.permissions.includes(permission)) throw new Error('forbidden');
    const input = isRecord(params.arguments) ? params.arguments : {};
    const scope = { org: principal.org, project: principal.project };
    switch (name) {
      case 'aqa_plan_run':
        return this.port.plan({ ...scope, profile: boundedString(input.profile, 'profile', 100) });
      case 'aqa_start_run':
        return this.port.start({
          ...scope,
          profile: boundedString(input.profile, 'profile', 100),
          idempotency_key: boundedString(input.idempotency_key, 'idempotency_key', 200),
        });
      case 'aqa_get_run':
        return this.port.status({ ...scope, run_id: boundedString(input.run_id, 'run_id', 200) });
      case 'aqa_cancel_run':
        return {
          cancelled: await this.port.cancel({
            ...scope,
            run_id: boundedString(input.run_id, 'run_id', 200),
            reason:
              typeof input.reason === 'string' && input.reason.trim()
                ? input.reason.slice(0, 1000)
                : 'cancelled by MCP operator',
          }),
        };
      case 'aqa_read_evidence':
        return this.port.evidence({ ...scope, run_id: boundedString(input.run_id, 'run_id', 200) });
      default:
        throw new Error('tool is not supported');
    }
  }

  get protocolVersion(): string | undefined {
    return this.negotiatedVersion;
  }
}

export interface McpHttpTransportOptions {
  /** Resolve the caller from request headers; return null on failed auth. */
  authenticate: (headers: Record<string, string>) => Promise<McpPrincipal | null>;
  max_body_bytes?: number;
  max_sessions?: number;
  session_ttl_ms?: number;
  now?: () => number;
}

interface McpSession {
  readonly id: string;
  readonly principal: McpPrincipal;
  readonly server: AqaMcpServer;
  last_seen_ms: number;
}

function jsonResponse(body: unknown, status: number, sessionId?: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  if (sessionId) headers.set('Mcp-Session-Id', sessionId);
  return new Response(JSON.stringify(body), { status, headers });
}

function headersRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Minimal authenticated MCP streamable-HTTP request/response transport.
 *
 * Sessions are intentionally in-process and bounded. A multi-replica host
 * must provide sticky routing or replace this boundary with a shared session
 * registry; silently making session state global would weaken tenant binding.
 */
export class McpHttpTransport {
  private readonly authenticate: McpHttpTransportOptions['authenticate'];
  private readonly maxBodyBytes: number;
  private readonly maxSessions: number;
  private readonly sessionTtlMs: number;
  private readonly now: () => number;
  private readonly sessions = new Map<string, McpSession>();

  constructor(port: McpRunPort, options: McpHttpTransportOptions) {
    this.authenticate = options.authenticate;
    this.maxBodyBytes = options.max_body_bytes ?? 262_144;
    this.maxSessions = options.max_sessions ?? 1_000;
    this.sessionTtlMs = options.session_ttl_ms ?? 30 * 60 * 1_000;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.maxBodyBytes) || this.maxBodyBytes < 1)
      throw new Error('MCP max_body_bytes must be a positive integer');
    if (!Number.isSafeInteger(this.maxSessions) || this.maxSessions < 1)
      throw new Error('MCP max_sessions must be a positive integer');
    if (!Number.isSafeInteger(this.sessionTtlMs) || this.sessionTtlMs < 1)
      throw new Error('MCP session_ttl_ms must be a positive integer');
    this.port = port;
  }

  private readonly port: McpRunPort;

  /** Handle one Fetch API request; safe to mount in Bun, Node or a Hono route. */
  async handle(request: Request): Promise<Response> {
    this.expireSessions();
    if (request.method !== 'POST' && request.method !== 'DELETE') {
      return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } });
    }
    const principal = await this.authenticate(headersRecord(request.headers));
    if (!principal) return jsonResponse({ error: 'unauthorized' }, 401);
    const sessionId = request.headers.get('Mcp-Session-Id');
    const protocolHeader = request.headers.get('MCP-Protocol-Version');

    if (request.method === 'DELETE') {
      if (!sessionId) return jsonResponse({ error: 'Mcp-Session-Id is required' }, 400);
      const session = this.sessions.get(sessionId);
      if (!session) return jsonResponse({ error: 'unknown MCP session' }, 404);
      if (!samePrincipal(session.principal, principal))
        return jsonResponse({ error: 'MCP session principal mismatch' }, 403);
      this.sessions.delete(sessionId);
      return new Response(null, { status: 204 });
    }

    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim();
    if (contentType !== 'application/json')
      return jsonResponse({ error: 'MCP requests must use application/json' }, 415);
    const advertisedLength = request.headers.get('content-length');
    if (advertisedLength && Number(advertisedLength) > this.maxBodyBytes)
      return jsonResponse({ error: 'MCP request body exceeds configured limit' }, 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > this.maxBodyBytes)
      return jsonResponse({ error: 'MCP request body exceeds configured limit' }, 413);
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, 400);
    }

    let session: McpSession | undefined;
    if (sessionId) {
      session = this.sessions.get(sessionId);
      if (!session) return jsonResponse({ error: 'unknown MCP session' }, 404);
      if (!samePrincipal(session.principal, principal))
        return jsonResponse({ error: 'MCP session principal mismatch' }, 403);
      if (protocolHeader && protocolHeader !== session.server.protocolVersion)
        return jsonResponse({ error: 'MCP protocol version mismatch' }, 400, session.id);
      session.last_seen_ms = this.now();
    } else {
      if (!isRecord(payload) || payload.method !== 'initialize')
        return jsonResponse({ error: 'Mcp-Session-Id is required after initialize' }, 400);
      if (this.sessions.size >= this.maxSessions)
        return jsonResponse({ error: 'MCP session capacity exhausted' }, 503);
      const id = randomUUID();
      const server = new AqaMcpServer(this.port);
      session = { id, principal, server, last_seen_ms: this.now() };
      this.sessions.set(id, session);
    }

    const response = await session.server.handle(payload, principal);
    if (!response)
      return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    if (
      !sessionId &&
      (response.error !== undefined || !isRecord(payload) || payload.method !== 'initialize')
    ) {
      this.sessions.delete(session.id);
      return jsonResponse(response, 400);
    }
    return jsonResponse(response, 200, session.id);
  }

  get sessionCount(): number {
    this.expireSessions();
    return this.sessions.size;
  }

  private expireSessions(): void {
    const cutoff = this.now() - this.sessionTtlMs;
    for (const [id, session] of this.sessions) {
      if (session.last_seen_ms <= cutoff) this.sessions.delete(id);
    }
  }
}

function samePrincipal(left: McpPrincipal, right: McpPrincipal): boolean {
  return left.id === right.id && left.org === right.org && left.project === right.project;
}
