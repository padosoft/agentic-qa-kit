import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateStatePath, validateStateGraph } from '../dist/index.js';

const graph = {
  schema_version: '1' as const,
  id: 'checkout',
  initial_state: 'cart',
  states: [{ id: 'cart' }, { id: 'paid' }, { id: 'cancelled', terminal: true }],
  transitions: [
    { id: 'pay', from: 'cart', to: 'paid', actor: 'customer', action: 'authorize payment' },
    { id: 'cancel', from: 'cart', to: 'cancelled', actor: 'customer', action: 'cancel order' },
    { id: 'refund', from: 'paid', to: 'cancelled', actor: 'merchant', action: 'refund payment' },
  ],
};

test('state graph validates reachability and evaluates a legal path', () => {
  const validation = validateStateGraph(graph);
  assert.equal(validation.state_count, 3);
  assert.deepEqual(evaluateStatePath(graph, ['pay', 'refund']), {
    valid: true,
    reached_state: 'cancelled',
    traversed: ['pay', 'refund'],
    violations: [],
  });
});

test('state graph rejects skipped transitions and unknown references', () => {
  const result = evaluateStatePath(graph, ['refund']);
  assert.equal(result.valid, false);
  assert.match(result.violations[0] ?? '', /expects paid/);
  assert.throws(
    () => validateStateGraph({ ...graph, states: [...graph.states, { id: 'orphan' }] }),
    /unreachable/,
  );
  assert.throws(
    () =>
      validateStateGraph({
        ...graph,
        transitions: [
          ...graph.transitions,
          { id: 'bad', from: 'cancelled', to: 'cart', actor: 'x', action: 'bad' },
        ],
      }),
    /terminal state/,
  );
});
