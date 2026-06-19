---
title: Architecture Overview
description: System-level architecture for local and self-hosted modes.
---

# Architecture Overview

`agentic-qa-kit` has two deployment modes: local/CI execution and self-hosted control plane execution.

```mermaid
flowchart TB
  subgraph Local["Local or CI"]
    CLI[aqa CLI]
    Packs[Packs]
    Runner[Runner]
    State[.aqa workspace]
  end
  subgraph Control["Self-hosted"]
    Server[Server API]
    Admin[Admin SPA]
    Store[(Postgres or MemoryStore)]
    Fleet[Runner fleet]
  end
  CLI --> Packs
  CLI --> Runner
  Runner --> State
  Admin --> Server
  Server --> Store
  Server --> Fleet
```

::: callout info "Boundary" icon:layout-dashboard
The CLI owns local developer workflows. The server and admin packages own shared team workflows, tenancy, audit, and operational views.
:::

## Package families

- `packages/kit`: CLI and command implementations.
- `packages/runner`: scenario execution and replay.
- `packages/schemas`: shared contracts.
- `packages/server`: HTTP API and queue surface.
- `packages/admin`: React admin.
- `packs/*`: reusable risk, scenario, probe, and oracle content.
