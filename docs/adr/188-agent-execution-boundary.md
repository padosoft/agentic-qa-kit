# ADR-188: Host-owned agent execution boundary

## Context

Profiles already distinguish `orchestrator` and `agent`, but the CLI previously
rejected every agent profile. Silently routing agent profiles through the
orchestrator would produce misleading audit identity and finding provenance.

## Decision

`aqa run` accepts `execution_mode: agent` only when the embedding host injects
an explicit `agentRunner`. The runner uses the same bounded probe contract and
cooperative cancellation as orchestrator execution, while `runScenario` emits
agent actors and marks findings with `execution_mode: agent`. Missing agent
drivers fail before run allocation; no provider, model, or credential is
implicitly selected by the CLI.

## Consequences

Agent integrations can own tool/MCP/LLM policy and supply a real driver without
making the core CLI provider-specific. Audit consumers can distinguish agent
actions from orchestrated probes. A provider-backed trajectory loop, model
pinning, tool policy, and live agent evaluation remain explicit host integration
work rather than being inferred from this boundary.
