# Getting started — junior-proof onboarding

> **Read this first if you've never touched the project.** You will be productive in 15 minutes. No prior knowledge of Bun, agentic QA, or LLM agents is assumed.
>
> **This is a skeleton** at v0.0.1. Task 8 will turn it into a guided tour with screenshots, troubleshooting, and OS-specific notes. The structure below is final — the content of each section will grow.

## TOC

1. [Who is this for](#1-who-is-this-for)
2. [What you will achieve](#2-what-you-will-achieve)
3. [Prerequisites](#3-prerequisites)
4. [Install Bun (5 min)](#4-install-bun)
5. [Install the kit (1 min)](#5-install-the-kit)
6. [Initialize a project (2 min)](#6-initialize-a-project)
7. [Run your first profile (5 min)](#7-run-your-first-profile)
8. [Open the report](#8-open-the-report)
9. [What's next](#9-whats-next)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Who is this for

You are a developer (or junior, or QA, or even non-technical curious) who wants to make a coding agent — Claude Code, Codex, Gemini CLI, GitHub Copilot — behave like a real QA engineer instead of a code-writer. You have not used `agentic-qa-kit` before. You may or may not know what "agentic QA" means. That's fine.

## 2. What you will achieve

In 15 minutes you will:

- Install Bun (a JavaScript runtime, faster Node alternative).
- Install `agentic-qa-kit` in a sample project (or your own).
- Generate the AQA workspace (`.aqa/` folder).
- Run the smoke profile — the agent will analyze the project, find risks, propose scenarios, and execute a fast check.
- See a report with findings (real bugs or false positives, both useful).

By the end you will understand the loop: **risk → invariant → scenario → probe → oracle → finding → replay**. Each of those words is defined in `docs/ecosystem-explained.md`.

## 3. Prerequisites

| Requirement | Why |
|---|---|
| A computer (Windows 10+, macOS 13+, Linux) | Run the tools |
| Internet connection | Install Bun and dependencies |
| A code editor (VS Code recommended) | Edit `.aqa/` files |
| A sample project OR your own project | Target of the QA |
| (Optional) Claude Code, Codex CLI, Gemini CLI, or GitHub Copilot CLI | To use agent mode |

## 4. Install Bun

> **What is Bun?** A modern JavaScript runtime, like Node but faster and bundled. We use it because `agentic-qa-kit` runs in seconds instead of minutes.

### Windows (PowerShell)

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

After install, close and reopen PowerShell. Verify:

```powershell
bun --version
```

You should see `1.1.x` or newer.

### macOS / Linux

```bash
curl -fsSL https://bun.sh/install | bash
```

Restart your terminal. Verify:

```bash
bun --version
```

### Already have Node 22 LTS?

You can use Node 22 instead. The kit detects your runtime and behaves the same. Stick with Node if your team has a Node-only policy.

### Stuck? See [§10 Troubleshooting](#10-troubleshooting).

## 5. Install the kit

In your project root:

```bash
bun add -d agentic-qa-kit
```

Verify:

```bash
bunx aqa --version
```

You should see the kit version.

## 6. Initialize a project

```bash
bunx aqa init
```

This will:

1. Detect your stack (Bun? Node? FastAPI? Next.js? has LLM? has DB?).
2. Create `.aqa/` with `project.yaml`, `testing.md`, `risk-map.yaml`, `profiles.yaml`.
3. Ask which agent targets you want to install files for (Claude / Codex / Gemini / Copilot — you can pick any subset, or none).
4. Print a summary of what was created.

Open `.aqa/testing.md`. This is your **agentic QA charter** — written for the agent, so it knows how to behave on this project.

## 7. Run your first profile

```bash
bunx aqa run --profile smoke
```

The smoke profile is the fast, safe, non-destructive QA pass. It executes ~10 scenarios in under 10 minutes. The agent (or the orchestrator, depending on profile mode) will:

- Read your `risk-map.yaml`
- Pick the top scenarios
- Run probes against your app (which you should have started: `bun run dev` or equivalent)
- Evaluate oracles
- Write findings to `.aqa/runs/<timestamp>/findings.jsonl`

## 8. Open the report

```bash
bunx aqa report
```

This generates `.aqa/runs/<timestamp>/summary.md` and prints a CLI summary:

```
AQA Run summary
---
Profile: smoke
Scenarios: 10 (8 passed, 2 failed)
Findings: 2 (1 P1, 1 P3)
Cost (LLM): $0.42
Duration: 4m 12s

Top findings:
- AQA-2026-0001 [P1] Cross-tenant data leak (verified, replay available)
- AQA-2026-0002 [P3] Missing rate limit on /api/search

See .aqa/runs/2026-05-17T10-00-00Z/summary.md for details.
```

For a finding that interests you:

```bash
bunx aqa replay AQA-2026-0001
```

This will re-run the bug reproduction (curl, Playwright trace, or shell script depending on type) and report whether it still reproduces.

## 9. What's next

- Read `docs/ecosystem-explained.md` to understand the methodology: risks, invariants, probes, oracles, replay levels.
- Read `docs/RULES.md` if you want to contribute.
- Try generating an agent-specific install:

  ```bash
  bunx aqa install-agent-files --targets claude,gemini
  ```

  Then open the project in Claude Code or Gemini CLI and try:

  ```text
  /aqa-riskmap
  ```

  The agent will use the installed skill to update your risk map.
- Open the admin panel (when available, post-v0.3):

  ```bash
  bunx aqa serve &
  bunx aqa-admin
  ```

## 10. Troubleshooting

> Full troubleshooting matrix per OS will land in v0.1.0 (Task 8). For now:

- **`bunx: command not found`** → Bun is not in PATH. Restart your terminal. On Windows, check that `C:\Users\<you>\.bun\bin` is in `PATH`.
- **`aqa init` fails with "permission denied"** → Run from a directory you own; do not run from `/` or `C:\`.
- **No findings on first run** → Normal if the project is small or the risk map is empty. Try `bunx aqa generate --packs api,llm-agent` to populate scenarios.
- **`gh` commands fail** → You need GitHub CLI authenticated: `gh auth login`. Only needed if you want to use Copilot review automation.
- **LLM calls fail with auth** → Set the env var your agent needs (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, etc.). The kit never bundles API keys.
- **Anything else** → Open an issue with the bug template, paste the full output redacted of secrets.

Found a doc gap? PRs welcome — please update `docs/LESSON.md` with what was unclear and how you resolved it.
