import { createHash } from 'node:crypto';
import { assertEndpointAllowed } from './transport-policy.js';
import type { LlmAdapter, LlmCallInput, LlmCallOutput } from './types.js';

export interface GoogleOptions {
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

export class GoogleAdapter implements LlmAdapter {
  readonly provider = 'google' as const;
  private readonly opts: GoogleOptions & { timeoutMs: number };
  constructor(opts: GoogleOptions = {}) {
    this.opts = { timeoutMs: 30_000, ...opts };
  }

  async call(input: LlmCallInput): Promise<LlmCallOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const baseUrl = (
      this.opts.baseUrl ??
      process.env.AQA_GOOGLE_BASE_URL ??
      'https://generativelanguage.googleapis.com/v1beta'
    ).replace(/\/$/, '');
    assertEndpointAllowed(baseUrl, this.opts);
    const maxTokens = Math.min(
      input.max_tokens ?? this.opts.maxOutputTokens ?? 4096,
      this.opts.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
    );
    const contents = input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: redact(m.content) }],
      }));
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      const apiKey = this.opts.apiKey ?? process.env.AQA_GOOGLE_API_KEY;
      if (apiKey) headers['x-goog-api-key'] = apiKey;
      const response = await (this.opts.fetch ?? fetch)(
        `${baseUrl}/models/${encodeURIComponent(input.model)}:generateContent`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            contents,
            ...(input.system
              ? { systemInstruction: { parts: [{ text: redact(input.system) }] } }
              : {}),
            generationConfig: {
              maxOutputTokens: maxTokens,
              ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
              ...(input.seed !== undefined ? { seed: input.seed } : {}),
            },
            ...(input.tool_definitions?.length
              ? {
                  tools: [
                    {
                      functionDeclarations: input.tool_definitions.map((t) => ({
                        name: t.name,
                        description: redact(t.description),
                        parameters: t.schema,
                      })),
                    },
                  ],
                }
              : {}),
          }),
          signal: controller.signal,
        },
      );
      const body = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: unknown }> };
          finishReason?: string;
        }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        modelVersion?: string;
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(
          `LLM ${response.status}: ${redact(body.error?.message ?? 'request failed')}`,
        );
      const candidate = body.candidates?.[0];
      const text = candidate?.content?.parts
        ?.map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('');
      if (!text) throw new Error('LLM response did not contain a text candidate');
      return {
        text: redact(text),
        tokens_in: body.usageMetadata?.promptTokenCount ?? 0,
        tokens_out: body.usageMetadata?.candidatesTokenCount ?? 0,
        model_version_hash: createHash('sha256')
          .update(body.modelVersion ?? input.model)
          .digest('hex'),
        finish_reason: candidate?.finishReason === 'MAX_TOKENS' ? 'length' : 'stop',
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
