# The AQA ecosystem, explained

> **Audience:** anyone who has heard "agentic QA" and wants to understand what `agentic-qa-kit` actually does, why it exists, and how each concept fits together. Written for a junior who has never touched LLM agents.
>
> **This is a skeleton** at v0.0.1. Task 8 will turn it into a deep guided introduction (≥ 5000 words) with diagrams, examples, and a glossary. The structure below is final.

## TOC

1. [The problem AQA solves](#1-the-problem-aqa-solves)
2. [Why "agentic" QA?](#2-why-agentic-qa)
3. [The mental model in 7 words](#3-the-mental-model-in-7-words)
4. [Where AQA sits in your stack](#4-where-aqa-sits-in-your-stack)
5. [The four packages](#5-the-four-packages)
6. [Concept by concept](#6-concept-by-concept)
7. [End-to-end example](#7-end-to-end-example)
8. [Common misconceptions](#8-common-misconceptions)
9. [Glossary](#9-glossary)
10. [Where to read next](#10-where-to-read-next)

---

## 1. The problem AQA solves

Coding agents (Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI) are amazing at writing code. They are bad at being **QA engineers** by default: they will gladly add a feature without imagining how a malicious user might exploit it, how the system could fail under load, how a second tenant might leak across, or how the LLM agent layer itself can be tricked.

When you ask an agent "please test this project", you get vague checks, optimistic green outputs, and missed regressions. The agent does not know:

- which risks matter for *this* product
- which invariants must always hold
- how to evaluate whether an observed behavior is a bug or noise
- how to reproduce a bug minimally
- how to turn the bug into a deterministic regression test

`agentic-qa-kit` (CLI: `aqa`) provides the **operating system** the agent needs: explicit risk maps, invariants, scenarios, probes, oracles, replay artifacts, and adapters that install the right skills into Claude / Codex / Gemini / Copilot so they all play QA the same way.

## 2. Why "agentic" QA?

"Agentic" means the work is performed by an autonomous (or semi-autonomous) AI agent that uses tools (shell, HTTP, browser, DB) to act on the world. Traditional QA is human-led and tool-driven. Agentic QA is human-supervised and agent-driven, with the human owning **what** to test and **how to judge**, while the agent owns **how to explore** and **what to try**.

This works only if the agent has rails. Without rails:

- the agent loops, burns money, drifts off-task
- false positives drown true bugs
- replay is impossible
- audit and compliance fail

With rails (this is what AQA provides):

- the agent operates inside a risk map it can interpret
- every claim has a probe and an oracle behind it
- every confirmed bug has a deterministic replay
- the team can see, replay, modify, and trust the work

## 3. The mental model in 7 words

```text
Risk → Invariant → Scenario → Probe → Oracle → Finding → Replay
```

Each word is defined in [§6 Concept by concept](#6-concept-by-concept). Memorize this chain. Every piece of AQA is one of these seven things or a tool that operates on them.

## 4. Where AQA sits in your stack

AQA does **not** replace Jest / Vitest / Playwright / Postman / k6. It orchestrates them. Its job is meta:

- "Given this codebase, what should we test?"
- "Given this risk, what's a realistic scenario?"
- "Given this scenario, what does success look like?"
- "Given this run, what's a real bug vs noise?"
- "Given this bug, how do we reproduce it deterministically next time?"

The actual probe execution and oracle evaluation can call your existing test infrastructure. Your test infrastructure stays. AQA wraps it.

## 5. The four packages

| Package | Role | Required for |
|---|---|---|
| `agentic-qa-kit` | CLI + engine + runner local + adapters + base packs | Everyone |
| `agentic-qa-kit-schemas` | JSON Schema / TypeScript types / Zod validators (zero deps) | Imported by everything |
| `agentic-qa-kit-admin` | React web panel viewer | Optional (visualize runs) |
| `agentic-qa-kit-server` | API control plane for multi-team / runners / cloud | Optional (multi-team or self-hosted enterprise) |

In **v0.1** only the first two ship as separate packages. The admin and server arrive in v0.3-v0.4. See `docs/architecture/reference.md`.

## 6. Concept by concept

> Skeleton — each section becomes a full chapter in v0.1.0.

### 6.1 Risk

A *thing that can go wrong* that matters to the product. Examples:

- "A user can read another tenant's data."
- "A payment can be charged twice."
- "The LLM agent can be tricked into calling a refund tool without confirmation."

Risks have severity (P0/P1/P2/P3) and live in `.aqa/risk-map.yaml`.

### 6.2 Invariant

A statement that must **always be true** for the risk to be considered controlled. Examples:

- "Every API response is scoped to the authenticated tenant."
- "Same idempotency key creates at most one payment effect."

Invariants are how you test for risks. They are the contract.

### 6.3 Scenario

A realistic, repeatable sequence of steps that exercises a risk area. Lives in `.aqa/scenarios/<pack>.yaml`. Has preconditions, steps, expectations, oracles.

### 6.4 Probe

A targeted attempt to break an invariant. Not a complete test by itself — an action or family of actions that try to make the invariant fail.

### 6.5 Oracle

The rule, mechanism, or signal that decides whether observed behavior is correct. Without an oracle, the agent sees strange things but can't tell bug from noise. Oracles can be deterministic (HTTP status assertion, DB query) or semi-deterministic (LLM judge, with all caveats — see ADR-002).

### 6.6 Finding

A structured record of something that may be a bug. Has severity, confidence, reproducibility breakdown, evidence (curl/Playwright trace/log/screenshot), suggested regression test. Lives in `.aqa/runs/<id>/findings.jsonl`.

### 6.7 Replay

The ability to re-execute a finding. Three levels (ADR-009):

- **Bug-level:** deterministic SUT reproduction (curl, Playwright). Required for `status=verified` in release gate.
- **Scenario-level:** re-execute the YAML scenario. Deterministic if probes and oracles are.
- **Agent-level:** re-execute the agent. Best-effort only — LLMs are not deterministic.

This three-level taxonomy is one of AQA's core contributions. Calling everything "replay" without distinguishing them is one of the most common antipatterns in agentic testing.

## 7. End-to-end example

> Skeleton — to be filled in v0.1.0 with: a SaaS multi-tenant app, an agent finds the cross-tenant bug, verifies it 3x, generates a regression test, opens a PR.

## 8. Common misconceptions

- ❌ "AQA is just a prompt library." → No, it's an operating system. The prompts only become valuable inside the framework (risk map, oracles, replay).
- ❌ "The LLM judges everything." → LLM-as-judge is one oracle of many, never used alone for release-gate decisions, always with calibration. See ADR-002.
- ❌ "Replay reproduces the agent." → No, replay reproduces the **bug** in the SUT. The agent run is non-deterministic by design.
- ❌ "We need to send all our code to a cloud LLM." → No. BYOK (bring your own key) is supported, on-prem LLM (vLLM, Bedrock private) too.
- ❌ "It's a Claude-only thing." → No. Claude, Codex, Gemini, Copilot are first-class adapters; the model-agnostic compatibility is a deliberate moat.

## 9. Glossary

> Skeleton — full glossary in v0.1.0.

| Term | Meaning |
|---|---|
| AQA | Agentic QA. The kit and the methodology. |
| SUT | System under test. Your app. |
| Pack | A reusable bundle of templates (risk areas, scenarios, skills) for a vertical (api, web-ui, llm-agent, security…). |
| Profile | A named configuration of a run (smoke, exploratory, security, release-gate). Sets budget, isolation, destructiveness. |
| Adapter | A connector that generates the right files for a specific agent target (Claude, Codex, Gemini, Copilot). |
| Oracle | See §6.5 |
| Probe | See §6.4 |
| Replay | See §6.7 |
| Determinism contract | The promise about what is reproducible and what is not, per finding. See ADR-009. |

## 10. Where to read next

- `docs/getting-started.md` — 15-minute hands-on
- `docs/methodology/agentic-qa.md` — the deep methodology paper
- `docs/architecture/reference.md` — system architecture
- `docs/security/threat-model.md` — STRIDE applied to AQA
- `docs/adr/` — architecture decisions
- `AGENTS.md` + `docs/RULES.md` — if you want to contribute
