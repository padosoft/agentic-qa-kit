import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adapterFor } from '../dist/index.js';

describe('adapterFor', () => {
  it('returns FixtureAdapter for "fixture"', () => {
    const a = adapterFor('fixture', { fixtures: [] });
    assert.equal(a.provider, 'fixture');
  });

  it('returns a scaffold that throws for providers without a live adapter', async () => {
    const a = adapterFor('bedrock');
    await assert.rejects(
      () =>
        a.call({
          provider: 'bedrock',
          model: 'bedrock-test',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      /not implemented at v0.3/,
    );
  });
});
