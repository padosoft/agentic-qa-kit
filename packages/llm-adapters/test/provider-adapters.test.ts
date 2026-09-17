import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BedrockAdapter } from '../dist/bedrock.js';
import { CohereAdapter } from '../dist/cohere.js';
import { GoogleAdapter } from '../dist/google.js';

const input = {
  provider: 'google' as const,
  model: 'gemini-test',
  system: 'You are safe',
  messages: [{ role: 'user' as const, content: 'card 4111111111111111' }],
  max_tokens: 32,
  temperature: 0,
};

describe('provider-specific LLM adapters', () => {
  it('Google maps native content, usage, tool schema and redacts evidence', async () => {
    let requestUrl = '';
    let requestBody: Record<string, unknown> | undefined;
    const adapter = new GoogleAdapter({
      apiKey: 'secret-google-key',
      baseUrl: 'https://google.test/v1beta',
      fetch: async (url, init) => {
        requestUrl = String(url);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: 'safe answer 4111111111111111' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3 },
            modelVersion: 'gemini-2-test',
          }),
          { status: 200 },
        );
      },
    });
    const result = await adapter.call({
      ...input,
      tool_definitions: [{ name: 'lookup', description: 'safe tool', schema: { type: 'object' } }],
    });
    assert.match(requestUrl, /models\/gemini-test:generateContent$/);
    assert.equal(
      requestBody?.generationConfig &&
        (requestBody.generationConfig as { maxOutputTokens: number }).maxOutputTokens,
      32,
    );
    assert.equal(result.tokens_in, 4);
    assert.equal(result.tokens_out, 3);
    assert.match(result.text, /REDACTED-PAN/);
    assert.equal(result.finish_reason, 'stop');
  });

  it('Cohere maps v2 message content and fails closed on provider errors', async () => {
    let authorization = '';
    const adapter = new CohereAdapter({
      apiKey: 'secret-cohere-key',
      baseUrl: 'https://cohere.test',
      fetch: async (_url, init) => {
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        return new Response(
          JSON.stringify({
            message: { content: [{ type: 'text', text: 'cohere answer' }] },
            usage: { tokens: { input_tokens: 5, output_tokens: 6 } },
            finish_reason: 'COMPLETE',
          }),
          { status: 200 },
        );
      },
    });
    const result = await adapter.call({ ...input, provider: 'cohere' });
    assert.equal(authorization, 'Bearer secret-cohere-key');
    assert.equal(result.text, 'cohere answer');
    assert.equal(result.tokens_in, 5);
    assert.equal(result.tokens_out, 6);

    const failing = new CohereAdapter({
      fetch: async () =>
        new Response(JSON.stringify({ error: 'Bearer provider-secret' }), { status: 503 }),
    });
    await assert.rejects(
      () => failing.call({ ...input, provider: 'cohere' }),
      /LLM 503: Bearer \[REDACTED\]/,
    );
  });

  it('Bedrock signs the Converse request without requiring an AWS SDK', async () => {
    let authorization = '';
    let securityToken = '';
    const adapter = new BedrockAdapter({
      region: 'eu-west-1',
      accessKeyId: 'AKIATESTKEY00000000',
      secretAccessKey: 'secret',
      sessionToken: 'session',
      endpoint: 'https://bedrock.test',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
      fetch: async (_url, init) => {
        const headers = new Headers(init?.headers);
        authorization = headers.get('authorization') ?? '';
        securityToken = headers.get('x-amz-security-token') ?? '';
        return new Response(
          JSON.stringify({
            output: { message: { content: [{ text: 'bedrock answer' }] } },
            usage: { inputTokens: 7, outputTokens: 8 },
            stopReason: 'end_turn',
          }),
          { status: 200 },
        );
      },
    });
    const result = await adapter.call({ ...input, provider: 'bedrock', model: 'amazon.test' });
    assert.match(authorization, /^AWS4-HMAC-SHA256 Credential=AKIA/);
    assert.equal(securityToken, 'session');
    assert.equal(result.text, 'bedrock answer');
    assert.equal(result.tokens_in, 7);
    assert.equal(result.tokens_out, 8);
  });
});
