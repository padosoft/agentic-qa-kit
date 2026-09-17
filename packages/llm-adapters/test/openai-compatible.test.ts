import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OpenAiCompatibleAdapter, adapterFor } from '../dist/index.js';

describe('OpenAiCompatibleAdapter', () => {
  it('redacts request content, bounds output, and parses usage', async () => {
    let request: RequestInit | undefined;
    const adapter = new OpenAiCompatibleAdapter('openai', {
      apiKey: 'do-not-log',
      baseUrl: 'https://llm.test/v1',
      maxOutputTokens: 50,
      fetch: async (_url, init) => {
        request = init;
        return new Response(
          JSON.stringify({
            model: 'model-v2',
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 4, completion_tokens: 2 },
          }),
          { status: 200 },
        );
      },
    });
    const result = await adapter.call({
      provider: 'openai',
      model: 'm',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'email a@b.test' }],
    });
    const body = JSON.parse(String(request?.body)) as {
      max_tokens: number;
      messages: Array<{ content: string }>;
    };
    assert.equal(body.max_tokens, 50);
    assert.match(body.messages[0]?.content ?? '', /REDACTED-EMAIL/);
    assert.equal(result.tokens_in, 4);
    assert.equal(result.tokens_out, 2);
    assert.equal(result.model_version_hash?.length, 64);
  });

  it('does not leak provider error content or hang past timeout', async () => {
    const adapter = adapterFor('vllm', {
      live: {
        timeoutMs: 5,
        allowPrivateNetwork: true,
        fetch: async () =>
          new Response(JSON.stringify({ error: { message: 'Bearer secret' } }), { status: 401 }),
      },
    });
    await assert.rejects(
      () => adapter.call({ provider: 'vllm', model: 'm', messages: [] }),
      (error: Error) => {
        assert.match(error.message, /401/);
        assert.doesNotMatch(error.message, /secret/);
        return true;
      },
    );
  });
});
