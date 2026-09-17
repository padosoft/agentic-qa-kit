import { createHash } from 'node:crypto';
import { assertEndpointAllowed } from './transport-policy.js';
import type { LlmAdapter, LlmCallInput, LlmCallOutput } from './types.js';

export interface CohereOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  maxOutputTokens?: number;
  allowPrivateNetwork?: boolean;
  allowedHosts?: readonly string[];
}
function redact(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\b\d{13,19}\b/g, '[REDACTED-PAN]');
}

export class CohereAdapter implements LlmAdapter {
  readonly provider = 'cohere' as const;
  private readonly opts: CohereOptions & { timeoutMs: number };
  constructor(opts: CohereOptions = {}) {
    this.opts = { timeoutMs: 30_000, ...opts };
  }
  async call(input: LlmCallInput): Promise<LlmCallOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const baseUrl = (
      this.opts.baseUrl ??
      process.env.AQA_COHERE_BASE_URL ??
      'https://api.cohere.com'
    ).replace(/\/$/, '');
    assertEndpointAllowed(baseUrl, this.opts);
    const maxTokens = Math.min(
      input.max_tokens ?? this.opts.maxOutputTokens ?? 4096,
      this.opts.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
    );
    try {
      const response = await (this.opts.fetch ?? fetch)(`${baseUrl}/v2/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.apiKey || process.env.AQA_COHERE_API_KEY
            ? { authorization: `Bearer ${this.opts.apiKey ?? process.env.AQA_COHERE_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages.map((m) => ({ role: m.role, content: redact(m.content) })),
          max_tokens: maxTokens,
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.tool_definitions?.length
            ? {
                tools: input.tool_definitions.map((t) => ({
                  name: t.name,
                  description: redact(t.description),
                  parameters: t.schema,
                })),
              }
            : {}),
        }),
        signal: controller.signal,
      });
      const body = (await response.json()) as {
        message?: { content?: string | Array<{ type?: string; text?: unknown }> };
        usage?: { tokens?: { input_tokens?: number; output_tokens?: number } };
        finish_reason?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(`LLM ${response.status}: ${redact(body.error ?? 'request failed')}`);
      const raw = body.message?.content;
      const text = Array.isArray(raw)
        ? raw.map((p) => (p.type === 'text' && typeof p.text === 'string' ? p.text : '')).join('')
        : raw;
      if (!text) throw new Error('LLM response did not contain message content');
      return {
        text: redact(text),
        tokens_in: body.usage?.tokens?.input_tokens ?? 0,
        tokens_out: body.usage?.tokens?.output_tokens ?? 0,
        model_version_hash: createHash('sha256').update(input.model).digest('hex'),
        finish_reason:
          body.finish_reason === 'MAX_TOKENS'
            ? 'length'
            : body.finish_reason === 'TOOL_CALL'
              ? 'tool_use'
              : 'stop',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError')
        throw new Error('LLM request timed out');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
