/**
 * Transport-neutral MCP control surface for AQA.
 *
 * HTTP/SSE or streamable-HTTP belongs to the host application. This module
 * owns the security-critical JSON-RPC/tool contract so every transport gets
 * the same allowlist, tenant boundary and bounded result shape.
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

  constructor(
    private readonly port: McpRunPort,
    opts: { supported_versions?: readonly string[] } = {},
  ) {
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
