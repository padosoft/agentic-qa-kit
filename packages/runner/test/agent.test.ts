import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AgentToolGuard } from '../dist/agent.js';
import { EventChainWriter } from '../dist/events.js';

function guard(options: Partial<ConstructorParameters<typeof AgentToolGuard>[0]> = {}) {
  return new AgentToolGuard({
    tools: [{ name: 'read_cart', run: async () => ({ total_minor: 1250 }) }],
    max_calls: 2,
    events: new EventChainWriter('/tmp/_ignore', { persist: false }),
    run_id: 'run-agent-tools',
    scenario_id: 'scenario-cart',
    ...options,
  });
}

describe('AgentToolGuard', () => {
  it('allows registered tools and records only bounded digests', async () => {
    const events = new EventChainWriter('/tmp/_ignore', { persist: false });
    const g = guard({ events });
    const result = await g.call('read_cart', { customer: 'customer-1', token: 'secret-value' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.output, { total_minor: 1250 });
    const event = events.snapshot()[0];
    assert.equal(event?.kind, 'tool_call');
    assert.equal(event?.payload.output_bytes, 20);
    assert.equal(JSON.stringify(event).includes('secret-value'), false);
    assert.equal(Object.hasOwn(event?.payload ?? {}, 'input'), false);
  });

  it('denies unknown tools and enforces the call budget', async () => {
    const events = new EventChainWriter('/tmp/_ignore', { persist: false });
    const g = guard({ events, max_calls: 1 });
    assert.equal((await g.call('write_order', {})).error, 'tool_not_allowed');
    assert.equal((await g.call('read_cart', {})).ok, true);
    assert.equal((await g.call('read_cart', {})).error, 'call_budget_exceeded');
    assert.deepEqual(
      events.snapshot().map((event) => event.payload.reason),
      ['tool_not_allowed', undefined, 'call_budget_exceeded'],
    );
  });

  it('fails closed for cancellation, handler errors and oversized output', async () => {
    const controller = new AbortController();
    controller.abort();
    assert.equal((await guard().call('read_cart', {}, controller.signal)).error, 'cancelled');

    const failed = guard({
      tools: [
        {
          name: 'broken',
          run: async () => {
            throw new Error('secret');
          },
        },
      ],
    });
    assert.equal((await failed.call('broken', {})).error, 'tool_failed');

    const oversized = guard({
      max_output_bytes: 4,
      tools: [{ name: 'large', run: async () => '12345' }],
    });
    assert.equal((await oversized.call('large', {})).error, 'output_too_large');
  });

  it('rejects invalid or duplicate tool configuration', () => {
    assert.throws(() => guard({ max_calls: 0 }), /max_calls/);
    assert.throws(
      () =>
        guard({
          tools: [
            { name: 'read_cart', run: async () => null },
            { name: 'read_cart', run: async () => null },
          ],
        }),
      /duplicate agent tool/,
    );
  });
});
