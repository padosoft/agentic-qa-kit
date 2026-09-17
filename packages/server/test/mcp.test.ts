import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '@aqa/store';
import { RunnerQueue } from '../dist/index.js';
import {
  AqaMcpServer,
  type McpPrincipal,
  type McpRunPort,
  createMcpRunPort,
} from '../dist/index.js';

const principal: McpPrincipal = {
  id: 'user-1',
  org: 'org-1',
  project: 'project-1',
  permissions: ['runs:read', 'runs:create'],
};

function port(): McpRunPort {
  return {
    async plan(input) {
      return {
        ...input,
        accepted: true,
        execution_mode: 'orchestrator',
        side_effects: 'none',
        warnings: [],
      };
    },
    async start(input) {
      return { run_id: `${input.org}-${input.project}-run-1`, status: 'queued' };
    },
    async status(input) {
      return { run_id: input.run_id, status: 'in_flight' };
    },
    async cancel() {
      return true;
    },
    async evidence(input) {
      return {
        run_id: input.run_id,
        event_count: 2,
        finding_count: 0,
        artifact_refs: ['events.jsonl'],
        truncated: false,
      };
    },
  };
}

async function initialized(server: AqaMcpServer): Promise<void> {
  const response = await server.handle(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    },
    principal,
  );
  assert.equal(response?.error, undefined);
  assert.equal(server.protocolVersion, '2025-06-18');
}

test('negotiates protocol and exposes only the bounded AQA tools', async () => {
  const server = new AqaMcpServer(port());
  await initialized(server);
  const response = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, principal);
  const tools = (response?.result as { tools: Array<{ name: string }> }).tools;
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['aqa_plan_run', 'aqa_start_run', 'aqa_get_run', 'aqa_cancel_run', 'aqa_read_evidence'],
  );
});

test('requires initialization and authentication before tool calls', async () => {
  const server = new AqaMcpServer(port());
  const before = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, principal);
  assert.equal(before?.error?.code, -32002);
  await initialized(server);
  const unauthenticated = await server.handle(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'aqa_get_run', arguments: { run_id: 'run-1' } },
    },
    null,
  );
  assert.equal(unauthenticated?.error?.code, -32003);
});

test('enforces per-tool permissions and tenant-scoped port inputs', async () => {
  const calls: string[] = [];
  const base = port();
  const wrapped: McpRunPort = {
    ...base,
    async start(input) {
      calls.push(`${input.org}/${input.project}/${input.profile}/${input.idempotency_key}`);
      return base.start(input);
    },
  };
  const server = new AqaMcpServer(wrapped);
  await initialized(server);
  const readOnly = { ...principal, permissions: ['runs:read'] as const };
  const forbidden = await server.handle(
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'aqa_start_run',
        arguments: { profile: 'release', idempotency_key: 'key-1' },
      },
    },
    readOnly,
  );
  assert.equal(forbidden?.error?.code, -32003);
  const started = await server.handle(
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'aqa_start_run',
        arguments: { profile: 'release', idempotency_key: 'key-1' },
      },
    },
    principal,
  );
  assert.equal(
    (started?.result as { structuredContent: { status: string } }).structuredContent.status,
    'queued',
  );
  assert.deepEqual(calls, ['org-1/project-1/release/key-1']);
});

test('keeps evidence response metadata-only and rejects malformed arguments', async () => {
  const server = new AqaMcpServer(port());
  await initialized(server);
  const evidence = await server.handle(
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'aqa_read_evidence', arguments: { run_id: 'run-1' } },
    },
    principal,
  );
  const result = (evidence?.result as { structuredContent: { artifact_refs: string[] } })
    .structuredContent;
  assert.deepEqual(result.artifact_refs, ['events.jsonl']);
  const invalid = await server.handle(
    {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'aqa_get_run', arguments: { run_id: '' } },
    },
    principal,
  );
  assert.equal(invalid?.error?.code, -32004);
  assert.doesNotMatch(JSON.stringify(evidence), /secret|token|payload/i);
});

test('binds the MCP lifecycle to the real queue and tenant-scoped store', async () => {
  const store = new MemoryStore();
  await store.saveProfile(
    {
      schema_version: '1',
      name: 'smoke',
      execution_mode: 'orchestrator',
      llm_usage: [],
      llm_budget_usd: null,
      parallelism: 1,
      require_deterministic_replay: false,
      packs: [],
      tags: [],
    },
    { org: principal.org, project: principal.project },
  );
  const queue = new RunnerQueue();
  const server = new AqaMcpServer(
    createMcpRunPort({
      store,
      queue,
      authenticate: async () => null,
    }),
  );
  await initialized(server);
  const planned = await server.handle(
    {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'aqa_plan_run', arguments: { profile: 'smoke' } },
    },
    principal,
  );
  assert.equal(
    (planned?.result as { structuredContent: { accepted: boolean; side_effects: string } })
      .structuredContent.accepted,
    true,
  );
  const started = await server.handle(
    {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'aqa_start_run',
        arguments: { profile: 'smoke', idempotency_key: 'mcp-run-1' },
      },
    },
    principal,
  );
  const runId = (started?.result as { structuredContent: { run_id: string } }).structuredContent
    .run_id;
  assert.equal(queue.snapshot()[0]?.payload.org, principal.org);
  const status = await server.handle(
    {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'aqa_get_run', arguments: { run_id: runId } },
    },
    principal,
  );
  assert.equal(
    (status?.result as { structuredContent: { status: string } }).structuredContent.status,
    'queued',
  );
  const crossTenant = await server.handle(
    {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'aqa_get_run', arguments: { run_id: runId } },
    },
    { ...principal, org: 'other-org' },
  );
  assert.equal((crossTenant?.result as { structuredContent: unknown }).structuredContent, null);
});
