import { createHash } from 'node:crypto';
import type { LlmAdapter, LlmCallInput, LlmCallOutput, LlmProvider } from './types.js';

export interface OpenAiCompatibleOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  /** Hard cap sent to the provider; prevents an unbounded generation. */
  maxOutputTokens?: number;
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED-AWS-KEY]')
    .replace(/\b\d{13,19}\b/g, '[REDACTED-PAN]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED-EMAIL]');
}

function hashModel(model: string): string {
  return createHash('sha256').update(model).digest('hex');
}

export class OpenAiCompatibleAdapter implements LlmAdapter {
  public readonly provider: LlmProvider;
  private readonly opts: Required<Pick<OpenAiCompatibleOptions, 'timeoutMs'>> &
    OpenAiCompatibleOptions;

  constructor(
    provider: Extract<LlmProvider, 'openai' | 'ollama' | 'vllm'>,
    opts: OpenAiCompatibleOptions = {},
  ) {
    this.provider = provider;
    this.opts = { timeoutMs: 30_000, ...opts };
  }

  async call(input: LlmCallInput): Promise<LlmCallOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const baseUrl = (
      this.opts.baseUrl ??
      process.env.AQA_LLM_BASE_URL ??
      this.defaultBaseUrl()
    ).replace(/\/$/, '');
    const apiKey = this.opts.apiKey ?? process.env.AQA_LLM_API_KEY;
    const maxTokens = Math.min(
      input.max_tokens ?? this.opts.maxOutputTokens ?? 4096,
      this.opts.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
    );
    const messages = [
      ...(input.system ? [{ role: 'system' as const, content: redact(input.system) }] : []),
      ...input.messages.map((message) => ({
        role: message.role,
        content: redact(message.content),
      })),
    ];
    try {
      const response = await (this.opts.fetch ?? fetch)(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: input.model,
          messages,
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          max_tokens: maxTokens,
          ...(input.seed !== undefined ? { seed: input.seed } : {}),
        }),
        signal: controller.signal,
      });
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(
          `LLM ${response.status}: ${redact(body.error?.message ?? 'request failed')}`,
        );
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string')
        throw new Error('LLM response did not contain choices[0].message.content');
      return {
        text: redact(content),
        tokens_in: body.usage?.prompt_tokens ?? 0,
        tokens_out: body.usage?.completion_tokens ?? 0,
        model_version_hash: hashModel(body.model ?? input.model),
        finish_reason: body.choices?.[0]?.finish_reason === 'length' ? 'length' : 'stop',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError')
        throw new Error('LLM request timed out');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private defaultBaseUrl(): string {
    if (this.provider === 'ollama') return 'http://127.0.0.1:11434/v1';
    if (this.provider === 'vllm') return 'http://127.0.0.1:8000/v1';
    return 'https://api.openai.com/v1';
  }
}
