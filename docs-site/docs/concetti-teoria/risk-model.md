---
title: Risk Model
description: Shape risk maps so agents produce useful findings.
---

# Risk Model

Risk maps are the heart of the kit. They convert product knowledge into executable QA intent.

```yaml
- id: r-cross-tenant-read
  category: tenancy
  title: One tenant can read another tenant's data
  severity: critical
  likelihood: possible
  invariants:
    - id: inv-tenant-isolation
      statement: A request scoped to tenant A never returns tenant B records.
```

::: collapsible "Risk fields"
- `id`: stable identifier used in reports.
- `category`: domain grouping, such as auth, tenancy, billing, or privacy.
- `title`: short human-readable risk.
- `severity`: impact if the risk materializes.
- `likelihood`: expected probability before exploration.
- `invariants`: testable truths that must hold.
:::

## Good invariant shape

An invariant should be concrete enough to test but broad enough to survive implementation changes.
