---
title: Release Gates
description: Use release-gate profiles without blocking on weak evidence.
---

# Release Gates

Release gates should block on verified, reproducible, high-impact findings.

::: steps
1. **Define blocking thresholds**
   Decide which severities and risk categories block release.
2. **Require replay**
   Prefer bug-level deterministic replay for P0 and P1 findings.
3. **Keep budgets explicit**
   Bound tokens, cost, time, and tool execution.
4. **Attach reports**
   Store report JSON and Markdown as CI artifacts.
:::

## Gate rule

$$
block = severity \in \{P0, P1\} \land replay = bug
$$

::: callout warning "Avoid noisy gates" icon:ban
Do not block a release on unverified narrative findings unless a human explicitly accepts that risk policy.
:::
