import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FixtureAdapter, makeFixtureKey } from '../dist/index.js';

const INPUT = {
  provider: 'fixture' as const,
  model: 'test-model',
  system: 'be brief',
  messages: [{ role: 'user' as const, content: 'hi' }],
};

describe('makeFixtureKey', () => {
  it('returns the same key for the same logical input', () => {
    assert.equal(makeFixtureKey(INPUT), makeFixtureKey({ ...INPUT }));
  });
  it('differs when the user message differs', () => {
    const other = { ...INPUT, messages: [{ role: 'user' as const, content: 'different' }] };
    assert.notEqual(makeFixtureKey(INPUT), makeFixtureKey(other));
  });
});

describe('FixtureAdapter', () => {
  it('returns the recorded response for a known key', async () => {
    const key = makeFixtureKey(INPUT);
    const a = new FixtureAdapter([
      { key, output: { text: 'hello', tokens_in: 1, tokens_out: 1, finish_reason: 'stop' } },
    ]);
    const r = await a.call(INPUT);
    assert.equal(r.text, 'hello');
    assert.equal(r.finish_reason, 'stop');
  });

  it('throws when no fixture matches', async () => {
    const a = new FixtureAdapter([]);
    await assert.rejects(() => a.call(INPUT), /no recorded response/);
  });
});
