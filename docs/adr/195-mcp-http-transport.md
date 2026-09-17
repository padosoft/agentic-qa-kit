# ADR-195: Authenticated MCP request/response HTTP transport

## Context

The MCP control contract and its queue/store binding were available only as a
direct JSON-RPC call. A host still had to implement session handling,
authentication binding and request limits, creating a high-risk integration
gap between local tests and a deployed agent connection.

## Decision

`@aqa/server` provides `McpHttpTransport`, a Fetch-compatible handler for the
JSON request/response subset of MCP streamable HTTP. It authenticates every
request, binds a session to the authenticated principal, negotiates the
server's supported protocol version, limits request bytes and concurrent
sessions, expires idle sessions, and supports explicit `DELETE` termination.
Responses are uncached JSON and notifications return `202` without a body.

The transport intentionally does not implement unsolicited SSE notifications.
The current AQA control surface has no server-push method; a host requiring
push must add an SSE stream with the same session and principal boundary.
Sessions are process-local, so multi-replica deployments require sticky
routing or a shared session registry.

## Consequences

Node, Bun and Hono hosts can mount one tested transport without duplicating the
security boundary. This is deployable transport evidence, not proof of a
production gateway, TLS, IdP or multi-replica session deployment; those remain
operational verification items.
