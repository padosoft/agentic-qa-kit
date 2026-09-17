import { createHash, createHmac } from 'node:crypto';
import type { LlmAdapter, LlmCallInput, LlmCallOutput } from './types.js';

export interface BedrockOptions {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  maxOutputTokens?: number;
  now?: () => Date;
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED-AWS-KEY]')
    .replace(/\b\d{13,19}\b/g, '[REDACTED-PAN]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED-EMAIL]');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function signAwsRequest(args: {
  method: string;
  url: URL;
  body: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  now: Date;
}): Record<string, string> {
  const amzDate = args.now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const shortDate = amzDate.slice(0, 8);
  const service = 'bedrock';
  const scope = `${shortDate}/${args.region}/${service}/aws4_request`;
  const payloadHash = sha256(args.body);
  const headers: Record<string, string> = {
    host: args.url.host,
    'content-type': 'application/json',
    'x-amz-date': amzDate,
    ...(args.sessionToken ? { 'x-amz-security-token': args.sessionToken } : {}),
  };
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((key) => `${key}:${headers[key]?.trim()}\n`).join('');
  const canonicalRequest = [
    args.method,
    args.url.pathname,
    args.url.search.slice(1),
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(`AWS4${args.secretAccessKey}`, shortDate);
  const regionKey = hmac(dateKey, args.region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${args.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
  };
}

export class BedrockAdapter implements LlmAdapter {
  readonly provider = 'bedrock' as const;
  private readonly opts: BedrockOptions & { timeoutMs: number };

  constructor(opts: BedrockOptions = {}) {
    this.opts = { timeoutMs: 30_000, ...opts };
  }

  async call(input: LlmCallInput): Promise<LlmCallOutput> {
    const region = this.opts.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
    const accessKeyId = this.opts.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = this.opts.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY;
    if (!region || !accessKeyId || !secretAccessKey) {
      throw new Error(
        '[llm-adapters] Bedrock requires AWS region and credentials from configuration or environment',
      );
    }
    const endpoint = this.opts.endpoint ?? `https://bedrock-runtime.${region}.amazonaws.com`;
    const url = new URL(`/model/${encodeURIComponent(input.model)}/converse`, endpoint);
    const maxTokens = Math.min(
      input.max_tokens ?? this.opts.maxOutputTokens ?? 4096,
      this.opts.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
    );
    const messages = input.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: [{ text: redact(message.content) }],
      }));
    const body = JSON.stringify({
      messages,
      ...(input.system ? { system: [{ text: redact(input.system) }] } : {}),
      inferenceConfig: {
        maxTokens,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      },
      ...(input.tool_definitions?.length
        ? {
            toolConfig: {
              tools: input.tool_definitions.map((tool) => ({
                toolSpec: {
                  name: tool.name,
                  description: redact(tool.description),
                  inputSchema: { json: tool.schema },
                },
              })),
            },
          }
        : {}),
    });
    const sessionToken = this.opts.sessionToken ?? process.env.AWS_SESSION_TOKEN;
    const headers = signAwsRequest({
      method: 'POST',
      url,
      body,
      region,
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
      now: this.opts.now?.() ?? new Date(),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const response = await (this.opts.fetch ?? fetch)(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      const result = (await response.json()) as {
        output?: { message?: { content?: Array<{ text?: unknown }> } };
        usage?: { inputTokens?: number; outputTokens?: number };
        stopReason?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(`LLM ${response.status}: ${redact(result.message ?? 'request failed')}`);
      const text = result.output?.message?.content
        ?.map((block) => (typeof block.text === 'string' ? block.text : ''))
        .join('');
      if (!text) throw new Error('LLM response did not contain a Bedrock text block');
      return {
        text: redact(text),
        tokens_in: result.usage?.inputTokens ?? 0,
        tokens_out: result.usage?.outputTokens ?? 0,
        model_version_hash: sha256(`${input.model}:${region}`),
        finish_reason:
          result.stopReason === 'max_tokens'
            ? 'length'
            : result.stopReason === 'tool_use'
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
