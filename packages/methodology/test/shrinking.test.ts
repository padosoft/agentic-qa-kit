import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shrinkJsonCounterexample } from '../dist/index.js';

describe('JSON counterexample shrinking', () => {
  it('removes irrelevant fields and array members while preserving failure', async () => {
    const result = await shrinkJsonCounterexample(
      { irrelevant: 'noise', request: { items: ['keep', 'noise', 'noise'] }, flag: true },
      (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        typeof candidate.request === 'object' &&
        candidate.request !== null &&
        !Array.isArray(candidate.request) &&
        Array.isArray(candidate.request.items) &&
        candidate.request.items.includes('keep'),
      { max_attempts: 200 },
    );

    assert.equal(result.value.request.items.length, 1);
    assert.equal(result.value.request.items[0], 'keep');
    assert.equal('irrelevant' in result.value, false);
    assert.equal(result.complete, true);
    assert.ok(result.attempts > 0);
  });

  it('fails closed on depth, size and invalid limits', async () => {
    await assert.rejects(
      () => shrinkJsonCounterexample({ nested: { value: true } }, () => true, { max_depth: 1 }),
      /max_depth/,
    );
    await assert.rejects(
      () => shrinkJsonCounterexample('secret', () => true, { max_bytes: 2 }),
      /max_bytes/,
    );
    await assert.rejects(
      () => shrinkJsonCounterexample(true, () => true, { max_attempts: 0 }),
      /max_attempts/,
    );
  });

  it('stops at the attempt budget and never emits candidate diagnostics', async () => {
    const result = await shrinkJsonCounterexample({ a: 'long value' }, () => false, {
      max_attempts: 1,
    });
    assert.equal(result.complete, false);
    assert.equal(result.attempts, 1);
    assert.deepEqual(result.value, { a: 'long value' });
  });

  it('handles wide JSON values without spreading child arrays', async () => {
    const wide = Array.from({ length: 20_000 }, () => false);
    const result = await shrinkJsonCounterexample(wide, () => false, {
      max_attempts: 1,
      max_depth: 1,
    });
    assert.equal(result.attempts, 1);
    assert.equal(result.complete, false);
  });
});
