import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adapterFor } from '../dist/index.js';

describe('adapterFor', () => {
  it('returns FixtureAdapter for "fixture"', () => {
    const a = adapterFor('fixture', { fixtures: [] });
    assert.equal(a.provider, 'fixture');
  });

  it('returns Bedrock adapter and fails closed when credentials are absent', async () => {
    const a = adapterFor('bedrock');
    await assert.rejects(
      () =>
        a.call({
          provider: 'bedrock',
          model: 'bedrock-test',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      /requires AWS region and credentials/,
    );
  });
});
