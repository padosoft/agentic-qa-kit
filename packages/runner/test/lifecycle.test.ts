import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RunLifecycle, transitionAllowed } from '../dist/lifecycle.js';

describe('transitionAllowed', () => {
  it('pending → running is legal', () => {
    assert.equal(transitionAllowed('pending', 'running'), true);
  });
  it('pending → succeeded is illegal (must pass through running)', () => {
    assert.equal(transitionAllowed('pending', 'succeeded'), false);
  });
  it('terminal states have no allowed transitions', () => {
    assert.equal(transitionAllowed('succeeded', 'running'), false);
    assert.equal(transitionAllowed('failed', 'succeeded'), false);
  });
  it('running → budget_exceeded is legal', () => {
    assert.equal(transitionAllowed('running', 'budget_exceeded'), true);
  });
});

describe('RunLifecycle', () => {
  it('records every transition in history', () => {
    const l = new RunLifecycle();
    l.transition('running');
    l.transition('succeeded');
    assert.equal(l.history.length, 2);
    assert.equal(l.history[0]?.from, 'pending');
    assert.equal(l.history[1]?.to, 'succeeded');
    assert.equal(l.isTerminal(), true);
  });
  it('throws on illegal transitions', () => {
    const l = new RunLifecycle();
    assert.throws(() => l.transition('succeeded'), /illegal transition/);
  });
});
