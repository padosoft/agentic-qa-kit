/**
 * Tests for the in-browser hash-chain verifier. Web Crypto's `crypto.subtle`
 * is available globally in Node 22+, so this test runs unchanged on both
 * runtimes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMockChain, parseEventLines, verifyEventChain } from '../src/data/audit.ts';

describe('parseEventLines', () => {
  it('parses one event per non-empty line', () => {
    const text = `${JSON.stringify({ prev_hash: '0', hash: 'x' })}\n\n${JSON.stringify({ prev_hash: 'x', hash: 'y' })}\n`;
    const events = parseEventLines(text);
    assert.equal(events.length, 2);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(parseEventLines(''), []);
    assert.deepEqual(parseEventLines('\n\n\n'), []);
  });
});

describe('verifyEventChain (browser-side via Web Crypto)', () => {
  it('accepts a well-formed mock chain', async () => {
    const { good } = await buildMockChain();
    const events = parseEventLines(good);
    const result = await verifyEventChain(events);
    assert.equal(result.ok, true);
    assert.equal(result.count, 5);
    assert.equal(result.bad_index, -1);
  });

  it('rejects the tampered counterpart', async () => {
    const { tampered } = await buildMockChain();
    const events = parseEventLines(tampered);
    const result = await verifyEventChain(events);
    assert.equal(result.ok, false);
    assert.equal(result.bad_index, 2);
    assert.match(result.reason ?? '', /hash mismatch/);
  });

  it('accepts an empty chain (vacuous truth)', async () => {
    const result = await verifyEventChain([]);
    assert.equal(result.ok, true);
    assert.equal(result.count, 0);
  });
});
