import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectConflict } from '../dist/conflict.js';

describe('detectConflict', () => {
  it('no-change when both version and content match', () => {
    const r = detectConflict(
      { version: '1', content_hash: 'a' },
      { version: '1', content_hash: 'a' },
    );
    assert.equal(r.kind, 'no-change');
    assert.equal(r.ok, true);
  });

  it('fast-forward identical-content writes regardless of version', () => {
    const r = detectConflict(
      { version: '1', content_hash: 'a' },
      { version: '2', content_hash: 'a' },
    );
    assert.equal(r.kind, 'identical');
    assert.equal(r.ok, true);
  });

  it('conflict when content differs at the same version', () => {
    const r = detectConflict(
      { version: '1', content_hash: 'a' },
      { version: '1', content_hash: 'b' },
    );
    assert.equal(r.kind, 'conflict');
    assert.equal(r.ok, false);
  });

  it('conflict when both version and content differ', () => {
    const r = detectConflict(
      { version: '1', content_hash: 'a' },
      { version: '2', content_hash: 'b' },
    );
    assert.equal(r.kind, 'conflict');
    assert.equal(r.ok, false);
  });
});
