# Ecosystem explained

> Every concept the kit ships with, in the order you encounter them while
> using it. Read this once after `getting-started.md`.

## 1. The mental model in 7 words

> **Risk × Invariant × Probe × Oracle × Replay.**

- A **Risk** is a thing that could go wrong (`r-token-replay`).
- An **Invariant** is a sentence that must hold under that risk
  (`Old tokens become invalid within 60s`).
- A **Probe** is a deterministic action that exercises the SUT
  (`POST /auth/rotate`, then `GET /me` with the old token).
- An **Oracle** decides whether the SUT honored the invariant
  (`http_status: 401`).
- A **Replay** is the evidence that the bug reproduces — a `repro.sh`, a
  Playwright spec, a SQL transcript.

Everything else is plumbing.

## 2. The two execution modes

The kit deliberately supports two execution modes, and every profile must
declare which one it uses.

| Mode               | Who runs the scenario                | Costs come from           | Determinism | Default for          |
|--------------------|--------------------------------------|---------------------------|-------------|----------------------|
| `orchestrator`     | The runner (`@aqa/runner`)           | Org-controlled LLM key    | High        | CI, release gates    |
| `agent`            | The host agent (Claude, Codex, …)    | User's vendor account     | Best-effort | Dev exploratory      |

`release-gate` profiles **must** use `orchestrator` mode (see ADR-001).

## 3. The data shapes you'll touch

| Shape           | File                              | Source of truth        |
|-----------------|-----------------------------------|------------------------|
| `Project`       | `.aqa/project.yaml`               | `@aqa/schemas`         |
| `RiskMap`       | `.aqa/risk-map.yaml`              | `@aqa/schemas`         |
| `Scenario`      | from a pack or hand-written       | `@aqa/schemas`         |
| `Profile`       | `.aqa/profiles.yaml`              | `@aqa/schemas`         |
| `Run` + `Event` | `.aqa/runs/<id>/{run.json,events.jsonl}` | `@aqa/schemas`  |
| `Finding`       | `.aqa/runs/<id>/findings.jsonl`   | `@aqa/schemas`         |
| `PackManifest`  | `packs/<name>/pack.yaml`          | `@aqa/schemas`         |

Every file validates against a Draft 2020-12 JSON Schema **and** a Zod
validator — same definition, two forms.

## 4. Packs

A pack ships a manifest, optional templates, scenarios, risks, oracles, and
probes. Five baseline packs ship in the box:

- `pack-core` (universal seed risks)
- `pack-api-core` (HTTP API risks)
- `pack-web-ui` (Playwright web UI risks)
- `pack-llm-agent` (agentic SUT risks)
- `pack-security` (OWASP Top 10 + Agentic Top 10)

`applies_when` (runtime / framework / db / sut_type / tags_any / tags_all)
decides whether a pack is installed in your project. The `core` pack is
always installed; the rest match the project profile.

## 5. Agents

Four agent hosts are tier-1: **Claude**, **Codex**, **Gemini**, **GitHub
Copilot**. `@aqa/adapters` renders the per-host instruction files plus a
minimal `aqa-run` skill. The capability matrix in `packages/adapters/README.md`
explains which features each host supports.

## 6. The audit trail

Every run writes `events.jsonl` — append-only, hash-chained. Each event has
`hash = sha256(prev_hash ‖ canonical(rest))`. An auditor (or the admin UI) can
walk the chain and detect any tampering. There is no SOC2-compliant story
without this, so the kit treats it as a hard requirement, not a feature.

## 7. The release-gate contract

A finding can only be `status: 'verified'` if the corresponding
`reproducibility[verification_floor].deterministic === true`. The Zod
validator enforces this; the emitted JSON Schema mirrors it via `if/then`.
Translation: **you cannot ship a "verified" bug that nobody can reproduce.**

## 8. Cost governance

Every profile declares an `llm_budget_usd`. The runner stops the loop when
that budget is exhausted and emits a `budget_exceeded` event. Cost rollups
live in `Run.totals.llm_cost_usd` and surface on the admin panel's Cost
screen. Hard guardrail.

## 9. The admin panel

`@aqa/admin` is a read-only viewer over `.aqa/runs/*`. It does **not** mutate
anything in the kit; that's by design. Editing flows (Scenario Studio, Risk
Editor) land in `task/admin-editing` (post-v0.1.0).

## 10. Where each component lives

```
agentic-qa-kit/
├── packages/
│   ├── schemas/       # @aqa/schemas      — Zod + JSON Schema source of truth
│   ├── kit/           # @aqa/kit          — `aqa` CLI (init/doctor/validate)
│   ├── pack-loader/   # @aqa/pack-loader  — pack discovery + applies_when
│   ├── adapters/      # @aqa/adapters     — Claude/Codex/Gemini/Copilot adapters
│   ├── runner/        # @aqa/runner       — lifecycle + events + findings + oracles
│   ├── reporter/      # @aqa/reporter     — markdown/json reporter + replay artifacts
│   └── admin/         # @aqa/admin        — Vite + React 19 admin scaffold
└── packs/
    ├── core/
    ├── api-core/
    ├── web-ui/
    ├── llm-agent/
    └── security/
```
