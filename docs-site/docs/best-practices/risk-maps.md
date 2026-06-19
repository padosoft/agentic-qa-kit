---
title: Risk Maps
description: Practical rules for useful risk maps.
---

# Risk Maps

Good risk maps are specific, stable, and testable.

::: callout tip "Prefer invariants over examples" icon:list-checks
Examples help, but invariants are what oracles can enforce across scenarios.
:::

## Checklist

- Use stable IDs.
- Include business-specific impact.
- Keep invariants observable.
- Add severity and likelihood deliberately.
- Link scenarios back to risks.

## Anti-patterns

::: collapsible "Generic risk"
`The application might have security bugs` is too broad to drive useful probes.
:::

::: collapsible "Implementation-only invariant"
`The controller calls checkTenant()` is too tied to code shape. Prefer observable behavior.
:::
