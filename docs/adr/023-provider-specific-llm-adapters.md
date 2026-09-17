# ADR-023 — Provider-specific bounded LLM adapters

## Status

Accepted — 2026-09-17

## Context

OpenAI-compatible chat is not a universal LLM protocol. Gemini uses
`generateContent`, model/user roles and `usageMetadata`; Cohere v2 uses a
different message/tool shape; Anthropic already has its native Messages
contract. Treating them as one adapter can produce successful HTTP responses
with semantically wrong prompts, tools or accounting.

## Decision

Implement one adapter per provider contract behind the shared `LlmAdapter`
interface. Google, Cohere and Bedrock now have native bounded adapters with
injected fetch transports, timeout cancellation, output caps, redaction, tool
mapping, usage parsing and model provenance hashes. Bedrock signs the Runtime
Converse request with AWS SigV4 and fails closed when region/credentials are
absent.

## Consequences

Fixtures and tests can validate each provider without credentials or network
access. Provider-specific auth, regional routing and response semantics are
visible in code rather than hidden behind a false compatibility claim. IAM,
credential rotation, regional routing and private endpoint reachability remain
deployment responsibilities.
