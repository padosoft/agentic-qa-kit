---
title: agentic-qa-kit
description: The agentic QA operating system for software projects.
---

# agentic-qa-kit

`agentic-qa-kit` turns a repository into an agentic QA lab. It gives coding agents a repeatable operating model built from risk maps, invariants, scenarios, probes, oracles, findings, and replay artifacts.

::: callout tip "Start here" icon:rocket
Use the quickstart when you want a local smoke pass. Use the architecture pages when you need to extend packs, runners, or the admin surface.
:::

::: grids
  ::: grid
    ::: card "Install and run" icon:terminal
    Create `.aqa/`, install agent files, run a smoke profile, and render a report.
    :::
  :::
  ::: grid
    ::: card "Model risk" icon:shield-check
    Declare the invariants that must not break before asking an agent to explore.
    :::
  :::
  ::: grid
    ::: card "Replay findings" icon:repeat
    Keep every verified finding tied to deterministic reproduction evidence.
    :::
  :::
:::

## Mental model

```text
Risk -> Invariant -> Scenario -> Probe -> Oracle -> Finding -> Replay
```

The kit is intentionally process-first. A run is useful only when the project risk map, selected packs, execution profile, and replay contract are all explicit.

## Where to go next

::: steps
1. **Quickstart**
   Follow [Quickstart](/get-started/quickstart) to initialize a project and run the first smoke pass.
2. **Architecture**
   Read [Architecture Overview](/architettura/overview) before extending the runner, server, store, or admin packages.
3. **Reference**
   Use [CLI Reference](/reference/cli), [API Reference](/reference/api), and [Schema API](/reference/schema-api) when wiring automation.
:::
