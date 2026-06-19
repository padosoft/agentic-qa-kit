---
title: Gotchas and Limits
description: Known limits and common mistakes.
---

# Gotchas and Limits

::: callout warning "Agentic QA is probabilistic" icon:alert-triangle
The kit improves structure and evidence. It does not make LLM exploration deterministic. Treat unverified findings as leads until replay proves them.
:::

## Common gotchas

- Running with placeholder risks creates shallow results.
- Treating agent prose as proof skips the oracle and replay contract.
- Using destructive profiles against shared environments can corrupt data.
- Ignoring cost budgets can turn broad exploration into waste.
- Documenting schema fields before implementation creates support debt.

## Limits

The kit cannot infer private business invariants without project input. It also cannot prove absence of defects; it can only explore declared risk surfaces under the selected budget.
