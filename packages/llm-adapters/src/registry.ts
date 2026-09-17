import { AnthropicAdapter, type AnthropicOptions } from './anthropic.js';
import { CohereAdapter, type CohereOptions } from './cohere.js';
import { FixtureAdapter } from './fixture.js';
import { GoogleAdapter, type GoogleOptions } from './google.js';
import { OpenAiCompatibleAdapter, type OpenAiCompatibleOptions } from './openai-compatible.js';
import type { LlmAdapter, LlmProvider } from './types.js';

class ScaffoldAdapter implements LlmAdapter {
  constructor(public readonly provider: LlmProvider) {}
  async call(): Promise<never> {
    throw new Error(
      `[llm-adapters] live ${this.provider} adapter not implemented at v0.3; the wire-protocol drivers ship in v0.4. Use FixtureAdapter for tests and CI.`,
    );
  }
}

/**
 * Return the right adapter for a given provider. Providers without a native
 * bounded implementation still return a ScaffoldAdapter and fail explicitly.
 */
export function adapterFor(
  provider: LlmProvider,
  opts?: {
    live?: OpenAiCompatibleOptions;
    anthropic?: AnthropicOptions;
    google?: GoogleOptions;
    cohere?: CohereOptions;
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
  return new ScaffoldAdapter(provider);
}
