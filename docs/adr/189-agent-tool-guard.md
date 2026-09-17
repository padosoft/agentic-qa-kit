# ADR-189: Bounded and auditable agent tool calls

## Context

Agent execution needs a safety boundary that is independent of the selected
LLM, MCP server, HTTP gateway, or local adapter. Allowing a host to inject a
driver without governing individual tool calls would leave the most important
agentic side effect outside the run's audit contract.

## Decision

`@aqa/runner` provides `AgentToolGuard` for host-owned agent integrations. It
requires an explicit tool registry and enforces:

- exact tool allowlisting;
- a positive maximum call budget;
- a maximum serialized output size;
- cooperative cancellation before and after dispatch;
- opaque hash-based audit evidence for inputs and outputs.

Every attempt emits a `tool_call` event with the agent identity, tool name,
call index, status, digest and bounded metadata. Raw tool arguments and results
remain in the host's controlled memory and are never placed in the event chain.

## Consequences

MCP and provider adapters share a consistent fail-closed tool policy and an
auditable trajectory substrate. The guard does not authorize a tool's business
semantics, perform network egress filtering, or choose a model; those remain
explicit adapter/deployment responsibilities and require their own evidence.
