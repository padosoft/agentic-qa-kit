import assert from 'node:assert/strict';
import test from 'node:test';
import { type StateGraph, compileStatefulJourney, executeStatefulJourney } from '../dist/index.js';

const GRAPH: StateGraph = {
  schema_version: '1',
  id: 'checkout-lifecycle',
  initial_state: 'cart',
  states: [{ id: 'cart' }, { id: 'paid' }, { id: 'fulfilled', terminal: true }],
  transitions: [
    { id: 'pay', from: 'cart', to: 'paid', actor: 'customer', action: 'authorize payment' },
    { id: 'ship', from: 'paid', to: 'fulfilled', actor: 'merchant', action: 'fulfill order' },
  ],
};

test('stateful journey compiles actor-bound transitions and executes observers plus cleanup', async () => {
  const plan = compileStatefulJourney({
    schema_version: '1',
    id: 'checkout-journey',
    graph: GRAPH,
    transition_path: ['pay', 'ship'],
    actors: [{ id: 'customer' }, { id: 'merchant' }],
    observers: [
      { id: 'payment-visible', after_transition_id: 'pay', check: async () => ({ ok: true }) },
    ],
  });
  const calls: string[] = [];
  const result = await executeStatefulJourney(
    plan,
    { customer: { role: 'buyer' }, merchant: { role: 'operator' } },
    async ({ actor_id, transition, context, signal }) => {
      calls.push(`${actor_id}:${transition.id}:${(context as { role: string }).role}`);
      assert.equal(signal.aborted, false);
      return { ok: true, observed_state: transition.to };
    },
    async ({ history }) => {
      calls.push(`cleanup:${history.length}`);
    },
  );
  assert.equal(result.status, 'succeeded');
  assert.equal(result.reached_state, 'fulfilled');
  assert.equal(result.steps.length, 2);
  assert.equal(result.observers[0]?.ok, true);
  assert.deepEqual(calls, ['customer:pay:buyer', 'merchant:ship:operator', 'cleanup:2']);
  assert.match(result.digest, /^[a-f0-9]{64}$/u);
});

test('stateful journey fails closed on an unobserved state and still cleans up', async () => {
  const plan = compileStatefulJourney({
    schema_version: '1',
    id: 'checkout-journey',
    graph: GRAPH,
    transition_path: ['pay', 'ship'],
    actors: [{ id: 'customer' }, { id: 'merchant' }],
  });
  let cleaned = false;
  const result = await executeStatefulJourney(
    plan,
    { customer: {}, merchant: {} },
    async ({ transition }) => ({
      ok: true,
      observed_state: transition.id === 'pay' ? 'wrong' : transition.to,
    }),
    async () => {
      cleaned = true;
    },
  );
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.failure, { phase: 'action', code: 'observed_state_mismatch', id: 'pay' });
  assert.equal(result.steps.length, 1);
  assert.equal(cleaned, true);
});

test('stateful journey aborts cooperatively and does not leak callback errors', async () => {
  const plan = compileStatefulJourney({
    schema_version: '1',
    id: 'checkout-journey',
    graph: GRAPH,
    transition_path: ['pay', 'ship'],
    actors: [{ id: 'customer' }, { id: 'merchant' }],
    max_duration_ms: 20,
  });
  const result = await executeStatefulJourney(
    plan,
    { customer: {}, merchant: {} },
    async ({ signal }) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new Error('provider secret must not be retained');
    },
    async () => ({ ok: true }),
  );
  assert.equal(result.status, 'aborted');
  assert.equal(result.failure?.code, 'journey_timeout');
  assert.equal(JSON.stringify(result).includes('provider secret'), false);
});

test('stateful journey requires a terminal path and every actor binding', () => {
  assert.throws(
    () =>
      compileStatefulJourney({
        schema_version: '1',
        id: 'checkout-journey',
        graph: GRAPH,
        transition_path: ['pay'],
        actors: [{ id: 'customer' }],
      }),
    /terminal state|no bound actor context/,
  );
  assert.throws(
    () =>
      compileStatefulJourney({
        schema_version: '1',
        id: 'checkout-journey',
        graph: GRAPH,
        transition_path: ['pay', 'ship'],
        actors: [{ id: 'customer' }],
        require_terminal: false,
      }),
    /no bound actor context/,
  );
});
