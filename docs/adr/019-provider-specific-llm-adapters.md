# ADR-019: Provider-specific bounded LLM adapters

- Status: accepted
- Date: 2026-09-17

## Context

OpenAI-compatible chat completions are not a universal LLM protocol. Anthropic
uses different authentication, system-message placement, content blocks, stop
reasons and tool schemas. Treating every provider as one adapter either loses
semantics or gives a false impression of production coverage.

## Decision

Implement each provider behind `LlmAdapter`, but keep wire contracts native.
`AnthropicAdapter` uses `/v1/messages`, `x-api-key`, bounded `max_tokens`,
redacted system/user/tool descriptions, abortable timeout, usage parsing and a
model provenance hash. The registry leaves Google, Cohere and Bedrock as
explicit failing scaffolds until their auth/region contracts and tests exist.

## Consequences

Live calls remain bounded and testable through injected fetch implementations;
unsupported providers cannot silently make a run appear live-capable. Each new
provider requires a contract test for auth, timeout, redaction, usage, tool
semantics and provider-specific failure behavior.
