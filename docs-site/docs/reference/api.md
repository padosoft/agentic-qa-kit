---
title: API Reference
description: Admin server API surface at a glance.
---

# API Reference

The admin server exposes project, run, finding, profile, risk, scenario, agent, audit, cost, queue, notification, token, and org surfaces.

::: callout info "Headers" icon:globe
Multi-tenant requests use `x-aqa-org` and `x-aqa-project` headers where the server route requires project context.
:::

## Representative resources

| Resource | Description |
| --- | --- |
| `/api/runs` | List and inspect runs. |
| `/api/findings` | Review, filter, and update findings. |
| `/api/profiles` | Manage execution profiles. |
| `/api/risks` | Manage project risks. |
| `/api/scenarios` | Manage scenario definitions. |
| `/api/agents` | Inspect agent targets. |
| `/api/audit` | Read audit events and verification data. |
| `/api/cost/summary` | Inspect cost attribution. |

## Contract rule

If an endpoint returns or accepts shared data, the shape should come from `packages/schemas` or a documented server-local type.
