---
title: Modello dati/contratto
description: Data contracts used across risks, scenarios, runs, and findings.
---

# Modello dati/contratto

The schemas package is the contract boundary. It keeps CLI, runner, server, admin, and packs aligned.

::: grids
  ::: grid
    ::: card "Risk" icon:shield
    Declares impact, likelihood, and invariants.
    :::
  :::
  ::: grid
    ::: card "Scenario" icon:route
    Describes an executable experiment tied to a risk surface.
    :::
  :::
  ::: grid
    ::: card "Finding" icon:bug
    Captures observed failure, severity, evidence, and replay level.
    :::
  :::
:::

## Contract sketch

```typescript
type Finding = {
  id: string;
  severity: "P0" | "P1" | "P2" | "P3" | "P4";
  riskId: string;
  invariantId?: string;
  status: "suspected" | "verified" | "dismissed";
  replay: {
    level: "bug" | "scenario" | "agent";
    artifacts: string[];
  };
};
```

::: callout warning "Schema drift" icon:git-compare
Do not document a field as supported unless it is represented in the shared schema or explicitly marked as planned.
:::
