---
title: Pipeline Workflow
description: End-to-end workflow from repository setup to verified findings.
---

# Pipeline Workflow

```mermaid
sequenceDiagram
  participant Dev
  participant CLI
  participant Packs
  participant Runner
  participant Report
  Dev->>CLI: aqa init
  Dev->>CLI: edit risk-map.yaml
  Dev->>CLI: aqa run --profile smoke
  CLI->>Packs: resolve matching packs
  Packs-->>Runner: scenarios, probes, oracles
  Runner-->>Report: events and findings
  Dev->>CLI: aqa report
```

::: steps
1. **Profile selects constraints**
   The profile sets allowed packs, budgets, destructive behavior, and verification requirements.
2. **Packs contribute scenarios**
   Matching packs bring reusable QA knowledge into the project.
3. **Runner executes probes**
   Probes touch the target system through HTTP, UI, LLM, migration, or custom commands.
4. **Reporter writes evidence**
   Reports convert findings into reviewable artifacts.
:::

## Workflow invariant

Every release-gate failure should be explainable from the original risk and reproducible from committed artifacts.
