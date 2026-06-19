---
title: ADR
description: Architecture decision records summarized for operators and contributors.
---

# ADR

The repository keeps Architecture Decision Records under `docs/adr/`. The summaries below capture the current contract.

::: collapsible "ADR 001: Dual execution mode"
The kit supports local mode for developer and CI workflows, plus self-hosted mode for teams that need shared tenancy, audit, runners, and admin visibility.
:::

::: collapsible "ADR 002: Three-level replay contract"
Replay distinguishes bug-level deterministic reproduction, scenario-level repeatability, and agent-level reproduction. Release gates should prefer bug-level evidence.
:::

::: collapsible "ADR 003: Hash-chained audit log"
Audit events are hash-chained so runs can be verified after export or review.
:::

::: collapsible "ADR 004: Zod as source of truth"
Runtime validation and generated JSON Schema derive from the same source to reduce drift between implementation and docs.
:::

::: collapsible "ADR 005: Bun-first with Node fallback"
The repo optimizes for Bun workflows while preserving Node compatibility for package consumers and tooling boundaries.
:::
