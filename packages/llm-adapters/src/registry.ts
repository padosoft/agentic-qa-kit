import { FixtureAdapter } from './fixture.js';
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
 * Return the right adapter for a given provider. Anthropic/OpenAI/Google/
 * Cohere/Ollama/vLLM/Bedrock all return ScaffoldAdapter at v0.3 — i.e. they
 * throw on call. This forces explicit fixture mode in tests and prevents
 * accidental live calls from leaking into CI.
 */
export function adapterFor(
  provider: LlmProvider,
  opts?: {
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
  return new ScaffoldAdapter(provider);
}
