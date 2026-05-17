import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adapterFor } from '../dist/index.js';

describe('adapterFor', () => {
  it('returns FixtureAdapter for "fixture"', () => {
    const a = adapterFor('fixture', { fixtures: [] });
    assert.equal(a.provider, 'fixture');
  });

  it('returns a scaffold that throws for live providers', async () => {
    const a = adapterFor('anthropic');
    await assert.rejects(
      () =>
        a.call({
          provider: 'anthropic',
          model: 'claude-opus-4-7',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      /not implemented at v0.3/,
    );
  });
});
