# @aqa/llm-adapters

Unified LLM client surface for `agentic-qa-kit`. Providers:

- `anthropic`, `openai`, `google`, `cohere`, `ollama`, `vllm`, `bedrock`,
  `fixture`.

All live providers ship as **scaffold adapters at v0.3** — they throw on
`call()` with an explicit message. The wire-protocol drivers land at v0.4.

For tests and CI, use the **FixtureAdapter**: record once, replay
deterministically by content hash. This is the canonical pattern for keeping
LLM-dependent code testable without live vendor calls.
