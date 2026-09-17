# @aqa/llm-adapters

Unified LLM client surface for `agentic-qa-kit`. Providers:

- `anthropic`, `openai`, `google`, `cohere`, `ollama`, `vllm`, `bedrock`,
  `fixture`.

`openai`, `ollama` and `vllm` use an OpenAI-compatible HTTP adapter with
timeouts, bounded output tokens and pre-request redaction. `anthropic` uses
the native Messages API with the same safety bounds and forwards validated tool
schemas. `google` uses Gemini `generateContent`, and `cohere` uses v2 `chat`,
each with provider-specific mapping and usage parsing. `bedrock` uses a native
AWS SigV4-signed Bedrock Runtime Converse adapter with explicit
region/credential configuration. Set
`AQA_LLM_API_KEY`/`AQA_LLM_BASE_URL` or pass `live` options; credentials are
never included in errors.

For tests and CI, use the **FixtureAdapter**: record once, replay
deterministically by content hash. This is the canonical pattern for keeping
LLM-dependent code testable without live vendor calls.
