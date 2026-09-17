import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnthropicAdapter, adapterFor } from '../dist/index.js';

describe('AnthropicAdapter', () => {
  it('bounds output, redacts input and parses native message usage', async () => {
    let request: RequestInit | undefined;
    const adapter = new AnthropicAdapter({
      apiKey: 'do-not-log',
      baseUrl: 'https://llm.test',
      maxOutputTokens: 32,
      fetch: async (_url, init) => {
        request = init;
        return new Response(
          JSON.stringify({
            model: 'claude-test',
            content: [{ type: 'text', text: 'safe response' }],
            usage: { input_tokens: 9, output_tokens: 3 },
            stop_reason: 'end_turn',
          }),
          { status: 200 },
        );
      },
    });
    const result = await adapter.call({
      provider: 'anthropic',
      model: 'claude-test',
      system: 'email a@b.test',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Bearer secret' }],
      tool_definitions: [{ name: 'lookup', description: 'lookup', schema: { type: 'object' } }],
    });
    const body = JSON.parse(String(request?.body)) as {
      max_tokens: number;
      messages: Array<{ content: string }>;
      tools: Array<{ input_schema: unknown }>;
    };
    assert.equal(body.max_tokens, 32);
    assert.match(body.messages[0]?.content ?? '', /REDACTED/);
    assert.equal(body.tools[0]?.input_schema !== undefined, true);
    assert.equal(result.tokens_in, 9);
    assert.equal(result.tokens_out, 3);
    assert.equal(result.finish_reason, 'stop');
  });

  it('is available through adapterFor and fails closed on malformed content', async () => {
    const adapter = adapterFor('anthropic', {
      anthropic: {
        fetch: async () => new Response(JSON.stringify({ content: [] }), { status: 200 }),
      },
    });
    assert.equal(adapter.provider, 'anthropic');
    await assert.rejects(
      () => adapter.call({ provider: 'anthropic', model: 'm', messages: [] }),
      /text content block/,
    );
  });
});
