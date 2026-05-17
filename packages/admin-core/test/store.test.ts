import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OptimisticEditor } from '../dist/editor.js';

describe('OptimisticEditor', () => {
  it('starts with base = effective and zero pending', () => {
    const e = new OptimisticEditor({ name: 'demo' });
    const s = e.snapshot();
    assert.deepEqual(s.base, { name: 'demo' });
    assert.deepEqual(s.effective, { name: 'demo' });
    assert.equal(s.pending.length, 0);
  });

  it('propose stacks a pending change and updates effective', () => {
    const e = new OptimisticEditor({ name: 'demo' });
    e.propose({ id: 'c1', next: { name: 'renamed' } });
    assert.deepEqual(e.snapshot().effective, { name: 'renamed' });
    assert.equal(e.snapshot().pending.length, 1);
  });

  it('commit moves pending → committed and updates base', () => {
    const e = new OptimisticEditor({ name: 'demo' });
    e.propose({ id: 'c1', next: { name: 'renamed' } });
    const s = e.commit('c1');
    assert.equal(s.pending.length, 0);
    assert.equal(s.committed.length, 1);
    assert.deepEqual(s.base, { name: 'renamed' });
  });

  it('rollback removes the change and restores effective to the previous step', () => {
    const e = new OptimisticEditor({ name: 'demo' });
    e.propose({ id: 'c1', next: { name: 'renamed' } });
    e.propose({ id: 'c2', next: { name: 'again' } });
    e.rollback('c2');
    assert.deepEqual(e.snapshot().effective, { name: 'renamed' });
  });

  it('rollback when only one pending change restores to base', () => {
    const e = new OptimisticEditor({ name: 'demo' });
    e.propose({ id: 'c1', next: { name: 'renamed' } });
    e.rollback('c1');
    assert.deepEqual(e.snapshot().effective, { name: 'demo' });
  });
});
