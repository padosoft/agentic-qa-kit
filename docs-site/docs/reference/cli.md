---
title: CLI Reference
description: Common aqa commands and expected outputs.
---

# CLI Reference

## Core commands

| Command | Purpose |
| --- | --- |
| `aqa init` | Scaffold `.aqa/` project files. |
| `aqa doctor` | Check local setup health. |
| `aqa validate` | Validate AQA YAML and schemas. |
| `aqa install-agent-files` | Install instructions and skills for selected agents. |
| `aqa run` | Execute a profile. |
| `aqa report` | Render latest or selected run report. |
| `aqa admin` | Start the local admin panel and API. |
| `aqa pack new` | Scaffold a pack. |

::: tabs
== tab "Smoke"
```bash
bunx aqa run --profile smoke
```
== tab "Report"
```bash
bunx aqa report --run-id RUN_ID --format md
```
== tab "Agents"
```bash
bunx aqa install-agent-files --targets claude,codex,gemini,copilot
```
:::
