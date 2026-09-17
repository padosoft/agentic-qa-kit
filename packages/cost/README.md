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

For operator-managed production pricing, parse a versioned catalog and verify
its Ed25519 signature against an out-of-band trust map before constructing the
tracker:

```ts
import { parsePricingCatalog, verifySignedPricingCatalog } from '@aqa/cost';

const catalog = verifySignedPricingCatalog(document, {
  'pricing-key-1': trustedPublicKeyPem,
});
const budget = new BudgetTracker({ budget_usd: 10, pricing_catalog: catalog });
```

The digest identifies the canonical model list; the signature identifies the
trusted operator key. Neither is evidence of current vendor billing until
usage reconciliation is performed.
