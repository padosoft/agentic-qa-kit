# @aqa/cost

Cost governance for `agentic-qa-kit`. Tracks LLM token + USD spend against a
per-run budget; flips `exhausted=true` when the budget would be crossed so the
runner can emit `budget_exceeded` and stop.

```ts
import { BudgetTracker } from '@aqa/cost';

const budget = new BudgetTracker({ budget_usd: profile.llm_budget_usd });
const state = budget.charge({ model: 'claude-sonnet-4-6', tokens_in, tokens_out });
if (state.exhausted) {
  // emit budget_exceeded event, abort dispatch
}
```

Pricing defaults are in `pricing.ts`. Override at construction or fork the
file for org-specific contract pricing.
