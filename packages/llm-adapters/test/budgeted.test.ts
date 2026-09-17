import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BudgetTracker } from '@aqa/cost';
import { BudgetedLlmAdapter, FixtureAdapter, makeFixtureKey } from '../dist/index.js';

describe('BudgetedLlmAdapter', () => {
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
});
