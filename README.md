<div align="center">

# `agentic-qa-kit`

### The agentic QA operating system for software projects

**Turn any repository into an agentic QA lab. Works with Claude · Codex · Gemini · Copilot. Bun-first. Enterprise-ready.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun%20%E2%89%A5%201.3-black)](https://bun.sh)
[![Node](https://img.shields.io/badge/runtime-node%2022%20LTS-339933)](https://nodejs.org)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)
[![CI](https://github.com/padosoft/agentic-qa-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/padosoft/agentic-qa-kit/actions/workflows/ci.yml)
[![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange)](#status)
[![Works with Claude · Codex · Gemini · Copilot](https://img.shields.io/badge/works%20with-Claude%20%E2%80%A2%20Codex%20%E2%80%A2%20Gemini%20%E2%80%A2%20Copilot-blueviolet)](#multi-agent)

> _Not a test runner. An **operating system** for agentic QA._
>
> A standardized framework that turns coding agents into QA engineers guided by **risk maps, invariants, scenarios, probes, oracles, and replay**.
> It is not a prompt. It is the reusable framework that makes the prompt operational, reproducible, versionable, and adaptable to every project.

</div>

---

<p align="center">
  <img src="docs/assets/banner.png" alt="Agentic QA Kit — agentic QA operating system" width="100%" />
</p>

## Table of contents

- [Why this exists](#why-this-exists)
- [What makes it different](#what-makes-it-different)
- [Quick start (junior-friendly)](#quick-start-junior-friendly)
- [The mental model in 7 words](#the-mental-model-in-7-words)
- [Multi-agent](#multi-agent)
- [Architecture at a glance](#architecture-at-a-glance)
- [Roadmap](#roadmap)
- [Status](#status)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)
- [Maintainers](#maintainers)

---

## Why this exists

Coding agents (Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI) are great at **writing** code. They are poor QA engineers by default: they will gladly add a feature without imagining how a malicious user might exploit it, how a second tenant might leak across, or how the LLM tool-calling layer can be tricked into refunding a payment without confirmation.

`agentic-qa-kit` provides the **operating system** the agent needs to behave like a senior QA engineer on **your** project:

- An explicit **risk map** with severity, invariants, probes, and oracles
- Pre-built **scenario packs** for APIs, web UIs, LLM agents, security, migrations
- **Adapters** that install the right skills for Claude / Codex / Gemini / Copilot
- A **runner** that executes profiles deterministically (smoke, exploratory, security, release-gate)
- **Findings** with three-level reproducibility, bug-level deterministic replay, and suggested regression tests
- Optional **admin panel** (React) and **server** (Bun/Node) for multi-team self-hosted deployments

## What makes it different

- 🧠 **Multi-agent native** — Claude · Codex · Gemini · Copilot first-class adapters, not "Claude with the others bolted on". Adapter capability negotiation, so each agent uses its best primitives (subagents, skills, slash commands, hooks).
- 🎯 **Deterministic replay where it matters** — three-level reproducibility (bug / scenario / agent). The kit never lies about LLM determinism. Bug-level deterministic replay is required for any release-gate verified finding.
- 🔒 **Sandbox by design** — container-per-scenario isolation default for security and release-gate profiles. Egress allowlists. Tool-call budgets. Resource limits. Cost kill-switches.
- 💰 **Cost governance built-in** — per-org / project / profile / scenario budgets in USD and tokens, hard kill-switches, attribution to risk areas. No more "an agent loop burned $400 overnight".
- 🏠 **BYOK + on-prem LLM** — bring your own Anthropic/OpenAI keys, or use vLLM / Bedrock private / Azure OpenAI VNet / llama.cpp. Air-gap deploy supported.
- 📋 **OWASP Top 10 Agentic (2026)** built-in security pack. Plus STRIDE / FMEA risk discovery (v0.6).
- 🧾 **Hash-chained audit log** + WORM export. SOC2 / ISO 27001 / GDPR / HIPAA alignment on the roadmap (v0.3 self-hosted, v1.0 GA).
- 🔁 **Process-first governance** — every PR follows a documented loop with Copilot Code Review. Lessons captured in `docs/LESSON.md` for permanent improvement.

## Quick start (junior-friendly)

> **Status note:** this section is a **preview of the v0.1.0 experience**. The `aqa` binary, the `agentic-qa-kit` npm package, and the commands below (`aqa init`, `aqa run`, `aqa replay`, `aqa install-agent-files`, etc.) are not yet published — the repo is in `v0.0.x` bootstrap and only governance + scaffolding are in place. Trying to `bun add -d agentic-qa-kit` today will fail. Detailed walk-through (also a preview) lives in [`docs/getting-started.md`](docs/getting-started.md).

<details>
<summary><strong>Preview the v0.1.0 quick start</strong> (click to expand)</summary>

### 1. Install Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

### 2. Install the kit in your project

```bash
cd /path/to/your/project
bun add -d agentic-qa-kit
```

> _If you don't have a project yet, clone `examples/bun-api` from this repo (available in v0.1.0)._

### 3. Initialize the AQA workspace

```bash
bunx aqa init
```

Detects your stack and creates `.aqa/` with `testing.md`, `risk-map.yaml`, `profiles.yaml`, and scenarios for the packs your project matches.

### 4. Install agent-specific files (pick one or many)

```bash
bunx aqa install-agent-files --targets claude,codex,gemini,copilot
```

This generates `CLAUDE.md` + `.claude/skills/aqa-*`, `AGENTS.md` + `.agents/skills/`, `GEMINI.md` + `.gemini/skills/`, `.github/copilot-instructions.md` + `.github/skills/`.

### 5. Run your first agentic QA pass

```bash
bunx aqa run --profile smoke
```

A 10-minute, non-destructive sweep. When it finishes:

```bash
bunx aqa report
```

You'll see findings like:

```
AQA-2026-0001 [P1] Cross-tenant data leak (verified, 3/3 deterministic replay)
AQA-2026-0002 [P3] Missing rate limit on /api/search
```

### 6. Replay a finding to confirm

```bash
bunx aqa replay AQA-2026-0001
```

Re-runs the deterministic bug reproduction (curl / Playwright / SQL) and tells you if it still reproduces. If it doesn't, the bug is fixed — closes the loop.

</details>

## The mental model in 7 words

```
Risk → Invariant → Scenario → Probe → Oracle → Finding → Replay
```

Every concept in AQA is one of these seven things or a tool that operates on them. See [`docs/ecosystem-explained.md`](docs/ecosystem-explained.md) for the deep introduction.

## Multi-agent

| Target | Files generated | Capability highlights |
|---|---|---|
| 🟣 **Claude Code** | `CLAUDE.md`, `.claude/skills/aqa-*`, `.claude/agents/aqa-*` | Skills, subagents (isolated context), hooks, MCP |
| 🟢 **Codex** | `AGENTS.md`, `.agents/skills/aqa-*`, optional Codex plugin | Skills, explicit subagents, plugins, MCP |
| 🔵 **Gemini CLI** | `GEMINI.md`, `.gemini/skills/aqa-*`, `.gemini/agents/`, `.gemini/commands/*.toml` | Skills, subagents, slash commands, MCP |
| ⚫ **GitHub Copilot CLI** | `.github/copilot-instructions.md`, `.github/skills/aqa-*`, `.github/agents/*.agent.md`, `.github/hooks/*.json` | Skills (auto-detects `.claude/skills`), custom agents, hooks |

Capability negotiation is runtime: the kit asks the agent target what it supports, and degrades gracefully when something is missing.

## Architecture at a glance

```text
+- Local mode (single dev / CI) -----------------------------+
|  bunx aqa CLI                                              |
|   |- engine + runner (sandboxed)                           |
|   |- packs (core, api, web-ui, llm-agent, security, ...)   |
|   |- adapters (Claude/Codex/Gemini/Copilot)                |
|   `- .aqa/  (project state, runs, findings, replay)        |
+------------------------------------------------------------+

+- Self-hosted (multi-team, post v0.3) ----------------------+
|  Control Plane (HA)                                        |
|   |- agentic-qa-kit-server (Hono+Bun or Express+Node)      |
|   |- agentic-qa-kit-admin (React)                          |
|   |- Postgres HA . Redis/NATS . S3-compat . Vault . OIDC   |
|   `- OTel Collector + Prometheus + Tempo + Loki            |
|                                                            |
|  Runners (per-team / CI shared / dev laptop)               |
|   - mTLS + OIDC to the control plane                       |
|   - execute scenarios next to the code (code never leaves) |
+------------------------------------------------------------+
```

Full diagram: [`docs/architecture/reference.md`](docs/architecture/reference.md) _(stub; expanded in v0.1.0)_.

## Roadmap

| Version | Theme | Highlights |
|---|---|---|
| `v0.0.1-governance` | Bootstrap | Process docs, CI, Copilot review automation, admin spec |
| `v0.1.x` | Foundation | Schemas, CLI (init/doctor/validate), 5 base packs, 4 adapters, runner+smoke, reports, admin viewer |
| `v0.2.x` | Determinism & cost | 3-level replay, cost governance, container sandbox default |
| `v0.3.x` | Enterprise table-stakes | Postgres backend, SSO/RBAC, pack signing, on-prem LLM, Helm chart, air-gap installer |
| `v0.4.x` | Admin editing | Scenario Studio, AI-generation with review workflow |
| `v0.5.x` | Multi-team | Server + runner fleet, findings dedup, bug→fix→verify-fix loop |
| `v0.6.x` | Methodology rigor | STRIDE/FMEA/OWASP integration, oracle ensemble, judge calibration |
| `v1.0` | GA enterprise | Pen test, SOC2 readiness, reference customers |

## Status

**Pre-alpha (`v0.0.x`).** The kit is in active foundation work. Do **not** use in production yet. Public APIs may change without notice until `v0.1.0`.

Track progress in [`docs/PROGRESS.md`](docs/PROGRESS.md). Architectural decisions in [`docs/adr/`](docs/adr/).

## Documentation

- [`docs/getting-started.md`](docs/getting-started.md) — junior onboarding
- [`docs/ecosystem-explained.md`](docs/ecosystem-explained.md) — concepts deep-dive
- [`docs/RULES.md`](docs/RULES.md) — contribution rules
- [`docs/adr/`](docs/adr/) — architecture decisions
- [`docs/design/admin-panel-template.md`](docs/design/admin-panel-template.md) — admin UI spec (for parallel template work)
- [`AGENTS.md`](AGENTS.md) — single source of truth for AI contributors
- [`docs/architecture/reference.md`](docs/architecture/reference.md) — full architecture _(stub; expanded in v0.1.0)_
- [`docs/security/threat-model.md`](docs/security/threat-model.md) — STRIDE applied to AQA _(stub; expanded in v0.1.0)_
- [`docs/methodology/agentic-qa.md`](docs/methodology/agentic-qa.md) — methodology paper _(stub; expanded in v0.1.0)_

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md), [`AGENTS.md`](AGENTS.md), and [`docs/RULES.md`](docs/RULES.md) first.

We follow a strict PR loop with **Copilot Code Review on every PR** (automated by `.github/workflows/copilot-review.yml`).

## Security

For vulnerabilities, use the private channel in [`SECURITY.md`](SECURITY.md) — do not file public issues.

## License

[Apache License 2.0](LICENSE). © Padosoft.

## Maintainers

[Padosoft](https://www.padosoft.com) — `info@padosoft.com`
