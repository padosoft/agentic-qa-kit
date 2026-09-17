import { AnthropicAdapter, type AnthropicOptions } from './anthropic.js';
import { BedrockAdapter, type BedrockOptions } from './bedrock.js';
import { CohereAdapter, type CohereOptions } from './cohere.js';
import { FixtureAdapter } from './fixture.js';
import { GoogleAdapter, type GoogleOptions } from './google.js';
import { OpenAiCompatibleAdapter, type OpenAiCompatibleOptions } from './openai-compatible.js';
import type { LlmAdapter, LlmProvider } from './types.js';

/**
 * Return the right native adapter for a given provider. Invalid runtime input
 * fails explicitly even though the TypeScript union is exhaustive.
 */
export function adapterFor(
  provider: LlmProvider,
  opts?: {
    live?: OpenAiCompatibleOptions;
    anthropic?: AnthropicOptions;
    google?: GoogleOptions;
    cohere?: CohereOptions;
    bedrock?: BedrockOptions;
    fixtures?: Parameters<typeof FixtureAdapter.prototype.call> extends never
      ? never
      : Array<{
          key: string;
          output: {
            text: string;
            tokens_in: number;
            tokens_out: number;
            finish_reason: 'stop' | 'length' | 'tool_use' | 'error';
          };
        }>;
  },
): LlmAdapter {
  if (provider === 'fixture') {
    return new FixtureAdapter(opts?.fixtures ?? []);
  }
  if (provider === 'openai' || provider === 'ollama' || provider === 'vllm') {
    return new OpenAiCompatibleAdapter(provider, opts?.live);
  }
  if (provider === 'anthropic') return new AnthropicAdapter(opts?.anthropic);
  if (provider === 'google') return new GoogleAdapter(opts?.google);
  if (provider === 'cohere') return new CohereAdapter(opts?.cohere);
  if (provider === 'bedrock') return new BedrockAdapter(opts?.bedrock);
  throw new Error(`[llm-adapters] unsupported provider: ${String(provider)}`);
}
