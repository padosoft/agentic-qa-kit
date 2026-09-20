<div align="center">

# `agentic-qa-kit`

### The agentic QA operating system for software projects

**Turn any repository into a risk-driven, replayable agentic QA lab. Works with Claude · Codex · Gemini · Copilot. Bun-first. Self-hostable.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun%20%E2%89%A5%201.3-black)](https://bun.sh)
[![Node](https://img.shields.io/badge/runtime-node%2022%20LTS-339933)](https://nodejs.org)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)
[![CI](https://github.com/padosoft/agentic-qa-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/padosoft/agentic-qa-kit/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/padosoft/agentic-qa-kit?display_name=tag&sort=semver)](https://github.com/padosoft/agentic-qa-kit/releases)
[![Status: review](https://img.shields.io/badge/status-pre--production%20review-f59e0b)](#status)
[![Works with Claude · Codex · Gemini · Copilot](https://img.shields.io/badge/works%20with-Claude%20%E2%80%A2%20Codex%20%E2%80%A2%20Gemini%20%E2%80%A2%20Copilot-blueviolet)](#multi-agent)

**Official docs:** [https://doc.agentic-qa-kit.padosoft.com](https://doc.agentic-qa-kit.padosoft.com)

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
- [What you get](#what-you-get)
- [AQA vs conventional testing tools](#aqa-vs-conventional-testing-tools)
- [Quick start (junior-friendly)](#quick-start-junior-friendly)
- [First project walkthrough](#first-project-walkthrough)
- [Examples cookbook](#examples-cookbook)
- [The mental model in 7 words](#the-mental-model-in-7-words)
- [How you use it](#how-you-use-it)
- [Screenshots](#screenshots)
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
- 📋 **OWASP Top 10 Agentic (2026)** built-in security pack. Plus STRIDE / FMEA and bounded source-aware risk discovery.
- 🧾 **Hash-chained audit log** + WORM export. SOC2 / ISO 27001 controls shipped, with private-deploy governance.
- 🔁 **Process-first governance** — every PR follows a documented loop with Copilot Code Review. Lessons captured in `docs/LESSON.md` for permanent improvement.

The short version: most QA tools answer **“did this test pass?”**. AQA answers
**“what must never break, which real boundary was exercised, what evidence
proves it, can another engineer reproduce it, and did the fix really remove the
bug?”**.

## What you get

### A complete agentic QA operating model

- **Risk discovery and coverage** — deterministic STRIDE, OWASP, FMEA and
  source-aware risk baselines; risk-to-invariant-to-scenario coverage reports.
- **Scenario packs** — reusable packs for core behavior, APIs, web UI, LLM
  agents, security, performance, migrations, mobile, desktop, realtime,
  Kubernetes, infrastructure, accessibility, compliance and commerce.
- **Capability-aware agent integration** — generated instructions, skills,
  agents, hooks, commands and MCP guidance for Claude Code, Codex, Gemini CLI
  and GitHub Copilot. Targets negotiate capabilities and degrade safely.
- **Profiles and runner** — smoke, exploratory, security and release-gate
  execution with bounded parallelism, isolation groups, wall-clock limits,
  tool budgets, resource limits and fail-closed driver capabilities.
- **Probes and oracles** — HTTP, SQL/PostgreSQL, Playwright and controlled shell
  drivers through explicit host-owned policy; temporal observers, invariants,
  oracle calibration and external-result ingestion for JUnit, SAST, k6, Locust,
  Playwright traces and OTLP.
- **Three-level replay** — deterministic bug replay, scenario replay and
  agent-level reproducibility. Findings carry redacted `repro.sh`, `repro.curl`,
  Playwright and structured JSON counterexample artifacts where applicable.
- **Evidence integrity** — canonical outcomes, hash-chained audit events,
  signed checkpoints, content-addressed artifacts, provenance, redaction and
  independent-store reconciliation.
- **Mutation-to-regression assurance** — reviewed mutant/risk/scenario links,
  digest-bound train/holdout plans, CLI enforcement and fail-closed observed
  regression gates.
- **Agent safety and spend control** — approval-bound commerce mutations,
  tenant/customer scope checks, idempotency, budget ledgers, cost attribution,
  signed pricing catalogs and hard kill switches.
- **Commerce Assurance contracts** — money arithmetic, checkout, inventory
  contention, payments/refunds, promotions, gift cards/store credit,
  subscriptions, dunning, disputes, payouts, loyalty, fulfillment/RMA and
  webhook replay/reconciliation boundaries.
- **Enterprise control plane** — multi-tenant API, RBAC/OIDC boundaries,
  PostgreSQL store and queue, S3-compatible artifacts, runner fencing,
  priority/DLQ/retry handling, OpenAPI/AsyncAPI/MCP surfaces, Prometheus/OTLP,
  Helm and air-gap-oriented deployment pieces.
- **Admin operations UI** — runs, events, logs, findings, replay, cost, audit
  chain, risk maps, scenarios, packs, profiles, agents, runners, tokens,
  notifications, organization, roles and SSO-oriented views.

### What AQA deliberately does not pretend

A passing fixture is not production evidence. A local in-memory journey is
labelled provider-neutral; a configured GitHub workflow is not proof until it
has executed against the protected provider. The current repository is ready
for side-project validation and self-hosted technical evaluation. Stripe/
issuer/warehouse/carrier execution, KMS/Vault/WORM/PITR drills and independent
security/compliance assurance remain explicit final promotion gates.

## AQA vs conventional testing tools

| Capability | Unit/integration suites | E2E tools (Playwright/Cypress) | API/load tools | Agent observability tools | **Agentic QA Kit** |
|---|---|---|---|---|---|
| Starts from business risk and invariants | Usually manual | Usually manual | Usually manual | Usually indirect | **First-class risk map and invariant model** |
| Uses coding agents as QA workers | No | Limited scripting | No | Sometimes | **Claude, Codex, Gemini and Copilot adapters** |
| Cross-layer journey | Per suite, fragmented | UI-centric | HTTP-centric | Trace-centric | **One scenario can bind API/UI/DB/agent/tool evidence** |
| LLM nondeterminism handling | Not applicable | Not applicable | Not applicable | Often statistical | **Three replay levels; never falsely labels an LLM run deterministic** |
| Bug reproduction | Test logs | Trace/video | Request logs | Span links | **Finding-bound replay plus minimized redacted counterexample** |
| Security boundaries | Separate tools | Limited | Limited | Usually outside scope | **Sandbox, egress, tool budgets, secret redaction and fail-closed oracles** |
| Mutation quality | Mutation score only | Rare | Rare | No | **Reviewed risk/scenario links and digest-bound holdout regression gate** |
| Financial side effects | Usually mocked | Often mocked | Provider-specific | Rare | **Approval, tenant, idempotency, reconciliation and ambiguity contracts** |
| Auditability | CI logs | Test artifacts | Metrics | Traces | **Canonical evidence, hash chain, signatures and retention lifecycle** |
| Multi-agent portability | None | None | None | Vendor-specific | **Generated native files for four agent ecosystems** |
| Cost governance | CI minutes | CI minutes | Requests | Token dashboards | **Per-org/project/profile/scenario token and USD budgets with kill switches** |
| Deployment posture | Test runner | Test runner | Test runner | SaaS/collector | **Local-first, self-hosted control plane, runners, Postgres/S3/Helm path** |

### The differentiator in one concrete example

An ordinary checkout test may assert `POST /checkout` returns `200`. An AQA
commerce journey additionally asks:

1. Was the cart owned by the correct tenant and customer?
2. Was the amount represented in integer minor units and reconciled?
3. Was human approval bound to this exact cart revision and total?
4. What happens when two carts race for the last item?
5. What happens when the provider commits but the response times out?
6. Does a webhook retry apply the effect exactly once?
7. Can the finding be replayed with a fresh read and without leaking secrets?

That is the difference between a green request test and an auditable assurance
journey.

## Quick start (junior-friendly)

> **Status note:** historical package milestone `v1.9` is superseded by the
> repository-side v2.0–v2.2 implementation work. Use the current roadmap audit
> below for the exact production-evidence boundary. Detailed walk-through:
> [`docs/getting-started.md`](docs/getting-started.md).

> **Current truth:** repository milestones through v2.2 are implemented and
> covered by the hosted technical matrix. AQA is excellent for side-project
> validation and self-hosted evaluation; provider-backed production evidence
> and independent assurance are still final promotion gates. Read the
> [roadmap audit](docs/internal/roadmap-completion-audit-2026-09-20.md) for the
> exact boundary.

### Choose your installation path

| You are... | Use this path |
|---|---|
| Trying AQA from the source repository | **Path A — clone and run locally**; no package registry token required |
| Adding AQA to an existing project | **Path B — install the published CLI** from GitHub Packages |
| Evaluating the complete product UI | **Path C — run the ecosystem example** from this repository |

### Before you start

- A project you can run locally (Bun, Node, Python, PHP, Go or another stack).
- A terminal and Git.
- Bun 1.3+ recommended; Node 22 LTS is supported as fallback.
- A safe local/test environment. Start with read-only or synthetic targets.
- Never put API keys, cookies, JWTs, payment data or customer PII in `.aqa/`,
  screenshots, findings or Markdown. AQA redacts evidence, but prevention is
  still your responsibility.

### 1. Install Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

Verify it:

```bash
bun --version       # should be 1.3 or newer
node --version      # Node 22 is the supported fallback
git --version
```

### Path A — clone the repository and try AQA without a registry token

This is the easiest path for a first evaluation:

```bash
git clone https://github.com/padosoft/agentic-qa-kit.git
cd agentic-qa-kit
bun install
bun run build:workspace

# Run the real example ecosystem journey.
bun run e2e:ecosystem
```

The ecosystem journey creates/uses an example target, executes AQA through a
real CLI boundary, persists run evidence and exercises the admin UI against
live data. It is the fastest way to see the product before connecting your own
application.

To use the locally built CLI from your own project while evaluating source:

```bash
# from the AQA repository
bun run --filter @aqa/kit build

# from your project, point PATH at the built binary for this shell
# PowerShell:
$env:PATH = "<path-to-agentic-qa-kit>\packages\kit\dist;$env:PATH"
# macOS/Linux:
export PATH="<path-to-agentic-qa-kit>/packages/kit/dist:$PATH"
aqa --help
```

For normal project usage, prefer Path B below so your project is decoupled from
the AQA checkout.

### 2. Tell your project where to find the kit (GitHub Packages auth)

GitHub Packages requires authentication even for public packages. One-time setup per machine — create a PAT with `read:packages` scope at [github.com/settings/tokens](https://github.com/settings/tokens), then add it to a per-project `.npmrc`:

```ini
# .npmrc — at the root of your project
@padosoft:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Export the token in your shell (or your CI secrets):

```bash
export GITHUB_TOKEN=ghp_XXXXXXXXXXXXXXXXXXXX
```

PowerShell:

```powershell
$env:GITHUB_TOKEN = "ghp_XXXXXXXXXXXXXXXXXXXX"
```

Do not paste a real token into `.npmrc`, the README, CI logs or a commit.

### 3. Install the kit in your project

```bash
cd /path/to/your/project
bun add -d @padosoft/agentic-qa-kit
```

> _If you don't have a project yet, clone `examples/bun-api` from this repo as a starting point._

Confirm the installation before changing configuration:

```bash
bunx aqa --version
bunx aqa --help
```

### 4. Initialize the AQA workspace + verify

```bash
bunx aqa init       # scaffold .aqa/{project,risk-map,profiles}.yaml + testing.md
bunx aqa doctor     # green/yellow/red checklist of kit health
bunx aqa validate   # schema-check every .aqa/* file against @aqa/schemas
```

`init` detects your stack (Bun/Node, framework, DB, SUT type) and creates a `.aqa/` directory anchored to the packs your project matches.

### 5. Install agent-specific files (one or many)

```bash
bunx aqa install-agent-files --targets claude,codex,gemini,copilot
```

Generates `CLAUDE.md` + `.claude/skills/aqa-*`, `AGENTS.md` + `.agents/skills/`, `GEMINI.md` + `.gemini/skills/`, and `.github/copilot-instructions.md` + `.github/skills/`. Existing files are preserved unless you pass `--force`. Add `--dry-run` to see what would change first.

### 6. Edit `.aqa/risk-map.yaml` (declare what must never break)

Replace the placeholder risk with the one that actually matters for your project. **The risk map is the heart of the kit — generic risks produce generic findings.**

```yaml
- id: r-token-replay
  category: auth
  title: Tokens remain valid past rotation
  severity: critical
  likelihood: possible
  invariants:
    - id: inv-token-rotation
      statement: Old tokens become invalid within 60 seconds of rotation.
```

### 7. Run your first agentic QA pass

```bash
bunx aqa run --profile smoke
```

A fast, non-destructive sweep. Each run is written to `.aqa/runs/<run-id>/` with `events.jsonl`, `findings.jsonl`, and 3-level replay artifacts (`repro.sh`, `repro.curl`, `repro.playwright.ts`). When a durable artifact backend is configured, the run also publishes byte-preserved canonical streams under `canonical/` with a digest manifest.

### 8. Render the report

```bash
bunx aqa report                       # latest run, Markdown + JSON
bunx aqa report --run-id <id>         # explicit run
bunx aqa report --format md           # just report.md
```

Writes `report.md` and `report.json` inside the same run directory. You'll see findings like:

```
AQA-2026-0001 [P1] Cross-tenant data leak (verified, 3/3 deterministic replay)
AQA-2026-0002 [P3] Missing rate limit on /api/search
```

### 9. Boot the admin panel (single command)

```bash
bunx aqa admin
```

Opens `http://127.0.0.1:5173`. The admin SPA + API server boot in one process, seeded from your local `.aqa/runs/`. Inspect runs, findings, replay artifacts, and verify the hash-chained audit log in-browser. `Ctrl-C` to stop.

| Flag | Effect |
|---|---|
| `--port <n>` | listen on a specific port (default 5173) |
| `--host <h>` | bind host (default `127.0.0.1`; use `0.0.0.0` to expose on LAN) |

### 10. Reproduce from generated artifacts

```bash
ls .aqa/runs/<run-id>/
# events.jsonl  findings.jsonl  report.md  report.json
# repro.sh      repro.curl       repro.playwright.ts
```

Each finding ships with a deterministic replay artifact so you can reproduce it, hand it to a teammate, or attach it to a PR.

> **Want the whole ecosystem in one go?** From a clone of `padosoft/agentic-qa-kit`, run `bun run e2e:ecosystem`. It boots `examples/bun-api`, runs a real `aqa run --profile smoke` against it, and opens the admin against the live data. Single command, end-to-end smoke.

## First project walkthrough

This is the copy/paste path for a junior engineer starting with an existing
application. The commands are intentionally small; run them in order.

### 1. Initialize and inspect what AQA discovered

```bash
cd my-project
bunx aqa init
bunx aqa doctor
bunx aqa validate
```

You should now have:

```text
.aqa/
├── project.yaml       # stack, SUT type and project identity
├── risk-map.yaml      # risks and invariants
├── profiles.yaml      # smoke/security/release-gate selection
└── testing.md         # generated guidance for your project
```

If `doctor` reports a warning, read it before running a release gate. Warnings
about optional drivers are honest capability gaps, not failures to hide.

### 2. Install the agent context

```bash
bunx aqa install-agent-files --targets claude,codex,gemini,copilot --dry-run
bunx aqa install-agent-files --targets claude,codex,gemini,copilot
```

Commit these generated files if your team wants every coding agent to follow
the same QA contract. They teach the agent to inspect risks first, preserve
evidence, respect tool/sandbox boundaries and distinguish unsupported from
passing.

### 3. Replace the placeholder risk with a real one

Example: a SaaS API must never return another tenant's invoice.

```yaml
# .aqa/risk-map.yaml
- id: tenant-invoice-isolation
  category: authorization
  title: An invoice is visible only to its owning tenant
  severity: critical
  likelihood: likely
  invariants:
    - id: invoice-tenant-bound
      statement: GET /api/invoices/:id rejects a principal from another tenant.
    - id: invoice-no-side-channel
      statement: Missing and cross-tenant invoices have equivalent safe responses.
```

The risk is more valuable than a generic “test invoices” instruction: it gives
the agent an invariant, a severity and an oracle target.

### 4. Run a safe first pass

```bash
bunx aqa run --profile smoke --seed first-local-run
bunx aqa report --format both
```

If your app needs a local server, start it first in another terminal. If your
project has no executable driver for a selected scenario, AQA records an
execution gap instead of fabricating a pass.

Inspect the result:

```bash
Get-ChildItem .aqa/runs                         # PowerShell
find .aqa/runs -maxdepth 2 -type f | sort      # macOS/Linux
```

### 5. Read, reproduce and verify a finding

```bash
bunx aqa report --run-id <run-id>
bunx aqa verify AQA-2026-0001 --attempts 3 --base-url http://127.0.0.1:3000
```

The finding directory contains redacted evidence and replay artifacts. A
verified finding is not “the agent said it failed”: it has a reproducible
boundary, an oracle result and preserved evidence. After fixing the application,
run `verify` again and attach the result to the pull request.

### 6. Open the local operations view

```bash
bunx aqa admin
# Open http://127.0.0.1:5173
```

Keep the default loopback bind. `aqa admin` is a local development viewer and
does not provide production authentication; do not expose it with
`--host 0.0.0.0` on an untrusted network.

### 7. Put the safe profile in CI

```yaml
# .github/workflows/aqa.yml
name: Agentic QA
on: [pull_request]
jobs:
  aqa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3.11'
      - run: bun install --frozen-lockfile
      - run: bunx aqa validate
      - run: bunx aqa run --profile smoke --seed ${{ github.event.pull_request.head.sha }}
      - run: bunx aqa report --format both
```

Use a separate protected environment for provider-backed evidence. Never put
provider credentials in `.aqa/`, generated replay files or the pull request.

## Examples cookbook

### Discover risks before writing scenarios

```bash
bunx aqa risk discover --method stride > .aqa/risk-baseline-stride.json
bunx aqa risk discover --method owasp > .aqa/risk-baseline-owasp.json
bunx aqa risk discover --method fmea > .aqa/risk-baseline-fmea.json
bunx aqa risk coverage --profile release-gate
```

Review generated risks before approving them. Risk generation is an
assistant, not an authorization to mutate your project configuration blindly.

### Use deterministic runs during debugging

```bash
bunx aqa run --profile smoke --seed checkout-cart-2026-09-20
bunx aqa report --run-id checkout-cart-2026-09-20
bunx aqa verify AQA-2026-0001 --attempts 5
```

The seed gives the run a stable identity. It does not make an inherently
nondeterministic LLM decision deterministic; AQA reports that boundary.

### Ingest existing test and security tools

```bash
bunx aqa ingest junit ./artifacts/junit.xml
bunx aqa ingest sast ./artifacts/semgrep.json
bunx aqa ingest k6 ./artifacts/k6-summary.json --threshold-file .aqa/k6-policy.json
bunx aqa ingest locust ./artifacts/locust.json
bunx aqa ingest playwright ./artifacts/trace.zip
```

This lets AQA correlate external evidence with risks without forcing a team to
throw away its existing test stack.

### Gate mutation quality and holdout regressions

```bash
bunx aqa mutation gate mutation.json --min-score 0.80
bunx aqa mutation coverage mutation.json mutation-manifest.json \
  --min-mapped-rate 1 --min-killed-rate 0.80
bunx aqa mutation regression mutation.json mutation-manifest.json evidence.json \
  --min-kill-rate 0.80
```

For a digest-bound holdout plan, pass the generated plan explicitly:

```bash
bunx aqa mutation regression mutation.json mutation-manifest.json evidence.json \
  --holdout-split holdout-plan.json --min-kill-rate 1.0
```

Plan-bound evidence without `--holdout-split` fails closed. The evaluator also
rejects overlapping train/holdout IDs and a plan from a different manifest.

### Validate disaster-recovery evidence

```bash
bunx aqa dr inventory backup-inventory.json --public-key trusted-ed25519.pem
bunx aqa dr restore backup-inventory.json restore-evidence.json \
  --public-key trusted-ed25519.pem
```

The release gate binds signed production evidence to the restore drill; a file
that merely claims a successful restore is not sufficient.

### Build a custom pack

```bash
bunx aqa pack new payments --sut-type api \
  --description "Payment and checkout assurance scenarios" \
  --author "Your Team"
```

Then edit the generated manifest and scenarios. See
[`docs/PACK-AUTHORING.md`](docs/PACK-AUTHORING.md) for schemas, trust and
distribution rules.

### Inspect the machine-readable run contract

```bash
node -e "const r=require('./.aqa/runs/<run-id>/report.json'); console.log(r.summary)"
```

Use `report.json` in CI annotations or dashboards; use `report.md` for humans.
Do not parse log text as an API.

## The mental model in 7 words

```
Risk → Invariant → Scenario → Probe → Oracle → Finding → Replay
```

Every concept in AQA is one of these seven things or a tool that operates on them. See [`docs/ecosystem-explained.md`](docs/ecosystem-explained.md) for the deep introduction.

## How you use it

1. `aqa init`: detect your repo and scaffold `.aqa/`.
2. `aqa install-agent-files --targets …`: write Claude/Codex/Gemini/Copilot instructions + skills.
3. Edit `risk-map.yaml`: declare what must never break.
4. `aqa run --profile smoke`: execute scenarios with probes + oracles.
5. `aqa report`: render `report.md` + `report.json` from the latest run.
6. `aqa admin`: boot the SPA + API on `127.0.0.1:5173`, seeded from local runs.
7. Inspect findings, replay deterministically, verify audit chain.
8. Iterate risks + scenarios until `release-gate` is green.

## Screenshots

The following screens show the current admin-panel direction. They are product snapshots, not proof that every screen is backed by durable storage or that every enterprise control is operational. The review documents distinguish the live API paths from demonstration or incomplete paths.

### Dashboard and operations

<p align="center">
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-Dashboard.png" alt="AQA admin dashboard" width="49%" />
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-Dashboard-dark.png" alt="AQA admin dashboard in dark mode" width="49%" />
</p>

<p align="center">
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-runs.png" alt="AQA runs" width="49%" />
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-findings.png" alt="AQA findings" width="49%" />
</p>

<p align="center">
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-run.png" alt="AQA run detail" width="49%" />
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-audit-log.png" alt="AQA audit log" width="49%" />
</p>

### Risk, scenarios and replay

<p align="center">
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-risk-map.png" alt="AQA risk map" width="49%" />
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-scenarios.png" alt="AQA scenarios" width="49%" />
</p>

<p align="center">
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-scenario.png" alt="AQA scenario detail" width="49%" />
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-replay.png" alt="AQA replay" width="49%" />
</p>

### Agents, access and governance

<p align="center">
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-agents.png" alt="AQA agents" width="49%" />
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-roles.png" alt="AQA roles" width="49%" />
</p>

<p align="center">
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-organization.png" alt="AQA organization" width="49%" />
  <img src="resources/screenshotts/agentic-qa-kit-Web-Panel-SSo.png" alt="AQA SSO" width="49%" />
</p>

<details>
<summary>Show the complete screenshot inventory</summary>

Dashboard, runs, run events, logs, cost, run cost, run replay, findings, audit log, risk map, scenarios, scenario detail, packs, profiles, agents, queue runners, notifications, API tokens, organization, roles, user, profile and SSO snapshots are stored in [`resources/screenshotts/`](resources/screenshotts/).

</details>

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

+- Self-hosted (multi-team, repository scope shipped) -------+
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

Full diagram: [`docs/architecture/reference.md`](docs/architecture/reference.md).

## Roadmap

| Version | Theme | Highlights |
|---|---|---|
| `v0.0.1-governance` | Bootstrap | Process docs, CI, Copilot review automation, admin spec |
| `v0.1.x` | Foundation | Schemas, CLI (init/doctor/validate), 5 base packs, 4 adapters, runner+smoke, reports, admin viewer |
| `v0.2.x` | Determinism & cost | 3-level replay, cost governance, container sandbox default |
| `v0.3.x` | Enterprise table-stakes — repository scope shipped | Postgres backend, SSO/RBAC, pack signing, on-prem LLM, Helm chart, air-gap installer; live KMS/WORM/IdP deployment evidence is a deferred final gate |
| `v0.4.x` | Admin editing | Scenario Studio, AI-generation with review workflow |
| `v0.5.x` | Multi-team | Server + runner fleet, findings dedup, bug→fix→verify-fix loop |
| `v0.6.x` | **Methodology rigor — repository scope shipped** | STRIDE/FMEA/OWASP integration, oracle calibration, mutation-to-regression evidence, digest-bound holdout plans; producer-scale and independent validation remain final gates |
| `v1.0` | **Historical roadmap milestone** | SOC2/ISO controls catalog, `aqa-audit-verify` CLI, pen-test scope doc; operational readiness is being revalidated |
| `v1.1` | **Polish — shipped** | Banner, full Helm chart (runner StatefulSet, Ingress, NetworkPolicy, Postgres subchart), 3 example targets (Bun, Next.js, Laravel) |
| `v1.2` | **Admin SPA wired — shipped** | Tailwind 4 + TanStack Router + Query + 12 screens, audit-chain verification in-browser via Web Crypto |
| `v1.3` | **Quality batch — shipped** | Admin server↔UI mapping, 6 detail routes, 12 new admin tests, CLI E2E smoke gate, threat-model expansion, CHANGELOG backfill |
| `v1.4` | **API surface — shipped** | 28 admin server routes, `MemoryStore` full coverage, multi-tenant via `x-aqa-org`/`x-aqa-project` headers |
| `v1.5` | **Admin design integration — shipped** | 30-screen hi-fi prototype bundled, Playwright E2E gate, theme + palette + Findings kanban |
| `v1.6` | **`aqa run` + bundled packs — shipped** | Three-tier pack discovery, atomic run-dir, applies_when filtering, agent-mode rejection until driver lands |
| `v1.7` | **Pack authoring + admin CRUD — shipped** | `PACK-AUTHORING.md`, `aqa pack new`, admin Create-pack/Import-manifest wizards, full Profile/Risk/Scenario CRUD (Delete/Edit/Clone), Agents wired to `/api/agents`, Operations + Admin pages wired to `/api/audit` / `/api/cost/summary` / `/api/queue` / `/api/notifications` / `/api/tokens` / `/api/orgs`, scenario YAML editor, schema-conforming mock-id migration, `Agent` schema, `agents:read`/`agents:edit` permissions, atomic `Store.createProfile/createScenario` |
| `v1.8` | **Live ecosystem e2e — shipped** | Real HTTP probe runner, release-gate finding enforcement, single-command ecosystem stack (`bun run e2e:ecosystem`), Playwright admin-against-live-API smoke, audit-chain canonical reconciliation |
| `v1.9` | **Junior quick-start truthing — shipped** | `aqa install-agent-files` + `aqa report` + `aqa admin` CLI verbs (previously documented but unwired), `@aqa/pack-author` extracted to break kit↔server build cycle, esbuild bundled `dist/cli.cjs`, GitHub Packages publish workflow on `v*` tags, README quick-start rewritten to match the actually-shipped CLI surface |
| `v2.0` | **Enterprise truth and safety — repository scope shipped** | Fail-closed runner/oracles, canonical outcomes, durable persistence, scoped authorization, SLO/coverage evidence, external-result ingestion, risk discovery, sandbox and secret-redaction hardening; live deployment proofs remain required |
| `v2.1` | **Commerce Assurance pilot — contracts shipped** | Commerce pack, money/order/payment/inventory contracts, provider and merchant adapters, webhook/retry/race journeys, refund reconciliation and safe synthetic fixtures; live provider evidence remains deployment-scoped |
| `v2.2` | **Stateful agentic QA — repository contracts shipped** | Capability preflight, temporal assertions, multi-actor execution, trace federation, holdout enforcement, shrink/replay evidence, chaos recovery and ecommerce failure journeys; protected producer scale and production provenance are deferred final gates |

## Status

**Enterprise truth status (2026-09-20).** The repository has moved beyond the
historical `v1.9` review: the enterprise control-plane, commerce contracts,
runner fencing, observability and protected provider-evidence handoffs are now
implemented and covered by hosted technical CI. Provider execution evidence and
independent security/compliance assurance are intentionally deferred to the
final promotion gate while the owner validates the kit against side projects;
they are not claimed as complete and do not block local development. See the
[roadmap completion audit](docs/internal/roadmap-completion-audit-2026-09-20.md)
for the requirement-by-requirement status; “implemented” is never treated as
live provider evidence.

Release notes per tag: [Releases page](https://github.com/padosoft/agentic-qa-kit/releases).
Live state: [`docs/PROGRESS.md`](docs/PROGRESS.md). Architectural
decisions: [`docs/adr/`](docs/adr/).

## Documentation

- [`docs/getting-started.md`](docs/getting-started.md) — junior onboarding
- [`docs/PACK-AUTHORING.md`](docs/PACK-AUTHORING.md) — write your own pack (community guide)
- [`docs/ecosystem-explained.md`](docs/ecosystem-explained.md) — concepts deep-dive
- [`docs/RULES.md`](docs/RULES.md) — contribution rules
- [`docs/adr/`](docs/adr/) — architecture decisions
- [`docs/design/admin-panel-template.md`](docs/design/admin-panel-template.md) — admin UI spec (for parallel template work)
- [`AGENTS.md`](AGENTS.md) — single source of truth for AI contributors
- [`docs/architecture/reference.md`](docs/architecture/reference.md) — full architecture
- [`docs/security/threat-model.md`](docs/security/threat-model.md) — STRIDE applied to AQA
- [`docs/methodology/agentic-qa.md`](docs/methodology/agentic-qa.md) — methodology paper
- [`docs/internal/enterprise-review-2026-09-17.md`](docs/internal/enterprise-review-2026-09-17.md) — current technical and strategic review
- [`docs/internal/ecommerce-qa-design-2026-09-17.md`](docs/internal/ecommerce-qa-design-2026-09-17.md) — Commerce Assurance proposal and priority journeys

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md), [`AGENTS.md`](AGENTS.md), and [`docs/RULES.md`](docs/RULES.md) first.

We follow a strict PR loop with **Copilot Code Review on every PR** (automated by `.github/workflows/copilot-review.yml`).

## Security

For vulnerabilities, use the private channel in [`SECURITY.md`](SECURITY.md) — do not file public issues.

## License

[Apache License 2.0](LICENSE). © Padosoft.

## Maintainers

[Padosoft](https://www.padosoft.com) — `info@padosoft.com`
