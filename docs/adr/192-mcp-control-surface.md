# ADR-192: Bounded MCP control surface

## Context

Agent clients need to plan, start, observe, cancel and read evidence from AQA.
Exposing the whole REST API as MCP tools would make the agent a privileged,
cross-tenant client and could leak raw event payloads. MCP protocol revisions
also evolve independently from AQA transports.

## Decision

`@aqa/server` exposes `AqaMcpServer`, a transport-neutral JSON-RPC dispatcher.
The host creates one instance per authenticated connection and injects an
`McpRunPort` that delegates to the authoritative queue/store. The dispatcher:

- negotiates an explicitly supported protocol version;
- exposes only five tools: plan, start, status, cancel and evidence metadata;
- requires a tenant-scoped principal and per-tool `runs:read`/`runs:create`;
- derives org/project from the principal instead of tool arguments;
- requires an idempotency key for starts and bounds all strings;
- returns metadata-only evidence summaries, never raw payloads or credentials.

`createMcpRunPort()` binds the contract to the existing `RunnerQueue` and
`StoreProvider`: profile planning is read-only, start uses the queue's scoped
idempotency contract, status/cancel are tenant-fenced, and evidence is counted
from the scoped store with a bounded metadata response. The streamable
HTTP/SSE transport, authentication middleware and provider execution remain
host responsibilities. They must preserve this contract.

## Consequences

MCP and REST can share one control-plane implementation without silently
granting an agent shell, arbitrary HTTP, filesystem or cross-tenant access.
Protocol support is testable without a live vendor, while deployed transport,
authentication and real runner/provider journeys remain required evidence.
