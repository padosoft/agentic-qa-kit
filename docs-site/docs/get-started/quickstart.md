---
title: Quickstart
description: Run the first agentic QA loop in a project.
---

# Quickstart

This path assumes a project that can install the kit from GitHub Packages and run Bun.

::: tabs
== tab "Install"
```bash
bun add -d @padosoft/agentic-qa-kit
```
== tab "Initialize"
```bash
bunx aqa init
bunx aqa doctor
bunx aqa validate
```
== tab "Run"
```bash
bunx aqa run --profile smoke
bunx aqa report
```
:::

::: steps
1. **Create the AQA workspace**
   `aqa init` creates `.aqa/project.yaml`, `.aqa/risk-map.yaml`, profiles, and a local testing guide.
2. **Install agent files**
   `aqa install-agent-files --targets claude,codex,gemini,copilot` writes the instructions each agent can consume.
3. **Edit the risk map**
   Replace placeholder risks with product-specific invariants.
4. **Run smoke**
   `aqa run --profile smoke` executes a fast, non-destructive pass and writes run artifacts.
5. **Render the report**
   `aqa report` produces Markdown and JSON outputs for review and triage.
:::

::: callout warning "Risk map first" icon:alert-triangle
Generic risks produce generic findings. Add at least one product-specific invariant before treating a run as meaningful.
:::

## Minimal invariant

```yaml
- id: r-token-replay
  category: auth
  title: Tokens remain valid after rotation
  severity: critical
  likelihood: possible
  invariants:
    - id: inv-token-rotation
      statement: Old tokens become invalid within 60 seconds of rotation.
```
