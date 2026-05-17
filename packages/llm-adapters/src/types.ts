export type LlmProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'cohere'
  | 'ollama'
  | 'vllm'
  | 'bedrock'
  | 'fixture';

export interface LlmCallInput {
  provider: LlmProvider;
  model: string;
  system?: string;
  messages: ReadonlyArray<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  /** Optional, opaque to the adapter; included in the fixture key. */
  tool_definitions?: ReadonlyArray<{ name: string; description: string; schema: unknown }>;
  /** Optional sampling parameters; each adapter maps to its vendor knobs. */
  temperature?: number;
  max_tokens?: number;
  seed?: number;
}

export interface LlmCallOutput {
  text: string;
  tokens_in: number;
  tokens_out: number;
  model_version_hash?: string;
  finish_reason: 'stop' | 'length' | 'tool_use' | 'error';
}

export interface LlmAdapter {
  provider: LlmProvider;
  call(input: LlmCallInput): Promise<LlmCallOutput>;
}
