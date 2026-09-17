import { createHash } from 'node:crypto';
import type { LlmAdapter, LlmCallInput, LlmCallOutput } from './types.js';

export interface AnthropicOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  maxOutputTokens?: number;
  apiVersion?: string;
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED-AWS-KEY]')
    .replace(/\b\d{13,19}\b/g, '[REDACTED-PAN]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED-EMAIL]');
}

export class AnthropicAdapter implements LlmAdapter {
  readonly provider = 'anthropic' as const;
  private readonly opts: AnthropicOptions & { timeoutMs: number };

  constructor(opts: AnthropicOptions = {}) {
    this.opts = { timeoutMs: 30_000, ...opts };
  }

  async call(input: LlmCallInput): Promise<LlmCallOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const baseUrl = (
      this.opts.baseUrl ??
      process.env.AQA_ANTHROPIC_BASE_URL ??
      'https://api.anthropic.com'
    ).replace(/\/$/, '');
    const apiKey = this.opts.apiKey ?? process.env.AQA_ANTHROPIC_API_KEY;
    const maxTokens = Math.min(
      input.max_tokens ?? this.opts.maxOutputTokens ?? 4096,
      this.opts.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
    );
    const messages = input.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: redact(message.content) }));
    try {
      const response = await (this.opts.fetch ?? fetch)(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': this.opts.apiVersion ?? '2023-06-01',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: JSON.stringify({
          model: input.model,
          max_tokens: maxTokens,
          messages,
          ...(input.system ? { system: redact(input.system) } : {}),
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.tool_definitions?.length
            ? {
                tools: input.tool_definitions.map((tool) => ({
                  name: tool.name,
                  description: redact(tool.description),
                  input_schema: tool.schema,
                })),
              }
            : {}),
        }),
        signal: controller.signal,
      });
      const body = (await response.json()) as {
        content?: Array<{ type?: string; text?: unknown }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
        stop_reason?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          `LLM ${response.status}: ${redact(body.error?.message ?? 'request failed')}`,
        );
      }
      const text = body.content
        ?.filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('');
      if (!text) throw new Error('LLM response did not contain a text content block');
      return {
        text: redact(text),
        tokens_in: body.usage?.input_tokens ?? 0,
        tokens_out: body.usage?.output_tokens ?? 0,
        model_version_hash: createHash('sha256')
          .update(body.model ?? input.model)
          .digest('hex'),
        finish_reason:
          body.stop_reason === 'max_tokens'
            ? 'length'
            : body.stop_reason === 'tool_use'
              ? 'tool_use'
              : 'stop',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('LLM request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
