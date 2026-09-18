import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BudgetTracker, MemoryBudgetLedger } from '@aqa/cost';
import { BudgetedLlmAdapter, FixtureAdapter, makeFixtureKey } from '../dist/index.js';

describe('BudgetedLlmAdapter', () => {
  it('emits exhaustion when authoritative usage reaches the budget', async () => {
    const events: Array<Record<string, unknown>> = [];
    const input = {
      provider: 'fixture' as const,
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user' as const, content: 'hello' }],
    };
    const adapter = new BudgetedLlmAdapter(
      new FixtureAdapter([
        {
          key: makeFixtureKey(input),
          output: { text: 'ok', tokens_in: 100, tokens_out: 200, finish_reason: 'stop' },
        },
      ]),
      new BudgetTracker({ budget_usd: 0.0033 }),
      {
        estimate: () => ({ model: input.model, tokens_in: 100, tokens_out: 100 }),
        onEvent: (event) => events.push(event),
      },
    );

    await assert.rejects(() => adapter.call(input), /budget exhausted after call/);
    assert.deepEqual(
      events.map((event) => event.kind),
      ['llm_call', 'budget_exceeded'],
    );
    assert.equal(events[1]?.status, 'exhausted');
  });

  it('emits bounded usage and budget-denied events without prompt content', async () => {
    const events: Array<Record<string, unknown>> = [];
    const input = {
      provider: 'fixture' as const,
      model: 'claude-sonnet-4-6',
      system: 'Authorization: Bearer do-not-leak',
      messages: [{ role: 'user' as const, content: 'customer@example.com' }],
    };
    const inner = new FixtureAdapter([
      {
        key: makeFixtureKey(input),
        output: { text: 'ok', tokens_in: 100, tokens_out: 100, finish_reason: 'stop' },
      },
    ]);
    const adapter = new BudgetedLlmAdapter(inner, new BudgetTracker({ budget_usd: 0.002 }), {
      estimate: () => ({ model: input.model, tokens_in: 100, tokens_out: 100 }),
      onEvent: (event) => events.push(event),
    });

    await adapter.call(input);
    await assert.rejects(() => adapter.call(input), /budget exhausted/);

    assert.deepEqual(
      events.map((event) => event.kind),
      ['llm_call', 'budget_exceeded'],
    );
    assert.equal(events[0]?.tokens_in, 100);
    assert.equal(events[0]?.tokens_out, 100);
    assert.equal(events[1]?.model, input.model);
    assert.equal(JSON.stringify(events).includes('do-not-leak'), false);
    assert.equal(JSON.stringify(events).includes('customer@example.com'), false);
  });

  it('admits, charges authoritative usage and blocks the next call', async () => {
    const input = {
      provider: 'fixture' as const,
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user' as const, content: 'hello' }],
    };
    const inner = new FixtureAdapter([
      {
        key: makeFixtureKey(input),
        output: { text: 'ok', tokens_in: 100, tokens_out: 100, finish_reason: 'stop' },
      },
    ]);
    const adapter = new BudgetedLlmAdapter(inner, new BudgetTracker({ budget_usd: 0.002 }), {
      estimate: (input) => ({ model: input.model, tokens_in: 100, tokens_out: 100 }),
    });
    await adapter.call(input);
    assert.equal(adapter.snapshot().calls, 1);
    await assert.rejects(() => adapter.call(input), /budget exhausted/);
    assert.equal(adapter.snapshot().calls, 1);
  });

  it('fails closed before dispatch when the estimate crosses the budget', async () => {
    let dispatched = false;
    const inner = {
      provider: 'fixture' as const,
      call: async () => {
        dispatched = true;
        return { text: 'never', tokens_in: 1, tokens_out: 1, finish_reason: 'stop' as const };
      },
    };
    const adapter = new BudgetedLlmAdapter(inner, new BudgetTracker({ budget_usd: 1 }), {
      estimate: (input) => ({ model: input.model, tokens_in: 1_000_000, tokens_out: 1_000_000 }),
    });
    await assert.rejects(
      () =>
        adapter.call({
          provider: 'fixture',
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      /dispatch blocked/,
    );
    assert.equal(dispatched, false);
  });

  it('prevents concurrent adapters from reserving beyond a shared ledger budget', async () => {
    const input = {
      provider: 'fixture' as const,
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user' as const, content: 'hello' }],
    };
    const fixture = {
      key: makeFixtureKey(input),
      output: { text: 'ok', tokens_in: 100, tokens_out: 100, finish_reason: 'stop' as const },
    };
    const ledger = new MemoryBudgetLedger();
    const make = () =>
      new BudgetedLlmAdapter(new FixtureAdapter([fixture]), new BudgetTracker({ budget_usd: 1 }), {
        ledger,
        ledger_key: 'org/project',
        budget_usd: 0.0035,
        estimate: () => ({ model: input.model, tokens_in: 100, tokens_out: 100 }),
      });
    const results = await Promise.allSettled([make().call(input), make().call(input)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  });

  it('attaches provider usage and pricing identity when settling a reservation', async () => {
    const input = {
      provider: 'fixture' as const,
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user' as const, content: 'hello' }],
    };
    const ledger = new MemoryBudgetLedger();
    const catalog = {
      schema_version: '1' as const,
      version: '2026-q3',
      effective_at: '2026-07-01T00:00:00Z',
      models: { 'claude-sonnet-4-6': { input_per_mtok: 3, output_per_mtok: 15 } },
      sha256: 'b'.repeat(64),
    };
    const adapter = new BudgetedLlmAdapter(
      new FixtureAdapter([
        {
          key: makeFixtureKey(input),
          output: { text: 'ok', tokens_in: 7, tokens_out: 3, finish_reason: 'stop' },
        },
      ]),
      new BudgetTracker({ budget_usd: 1, pricing_catalog: catalog }),
      {
        ledger,
        ledger_key: 'org/audit',
        budget_usd: 1,
        estimate: () => ({ model: input.model, tokens_in: 7, tokens_out: 3 }),
      },
    );
    await adapter.call(input);
    assert.equal(adapter.snapshot().pricing_version, '2026-q3');
  });
});
