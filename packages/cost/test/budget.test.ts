import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BudgetTracker } from '../dist/budget.js';

describe('BudgetTracker', () => {
  it('charges per-call cost based on input + output tokens', () => {
    const t = new BudgetTracker({ budget_usd: 100 });
    const s = t.charge({ model: 'claude-sonnet-4-6', tokens_in: 1_000_000, tokens_out: 1_000_000 });
    // input 1M * $3 + output 1M * $15 = $18
    assert.equal(Math.round(s.spent_usd * 100) / 100, 18);
    assert.equal(s.calls, 1);
    assert.equal(s.exhausted, false);
  });

  it('flips exhausted=true when the spend would reach the budget', () => {
    const t = new BudgetTracker({ budget_usd: 1 });
    const s = t.charge({ model: 'claude-sonnet-4-6', tokens_in: 100_000, tokens_out: 100_000 });
    // 100k in * $3/Mtok + 100k out * $15/Mtok = 0.3 + 1.5 = 1.8 → exhausted
    assert.equal(s.exhausted, true);
  });

  it('unlimited budget (null) never exhausts', () => {
    const t = new BudgetTracker({ budget_usd: null });
    const s = t.charge({ model: 'claude-opus-4-7', tokens_in: 10_000_000, tokens_out: 10_000_000 });
    assert.equal(s.exhausted, false);
  });

  it('wouldExhaust answers a hypothetical without mutating', () => {
    const t = new BudgetTracker({ budget_usd: 1 });
    assert.equal(
      t.wouldExhaust({ model: 'claude-sonnet-4-6', tokens_in: 100_000, tokens_out: 100_000 }),
      true,
    );
    assert.equal(t.snapshot().calls, 0);
  });

  it('unknown model contributes zero cost (and tracks tokens)', () => {
    const t = new BudgetTracker({ budget_usd: 100 });
    const s = t.charge({ model: 'unknown-llm', tokens_in: 1000, tokens_out: 1000 });
    assert.equal(s.spent_usd, 0);
    assert.equal(s.tokens_in, 1000);
  });
});
