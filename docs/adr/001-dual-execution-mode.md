# ADR-001 — Dual execution mode (agent-as-actor vs orchestrator-as-actor)

- **Status:** Accepted
- **Date:** 2026-05-17
- **Tags:** core / determinism / cost-governance

## Context

The original proposal mixed two execution paradigms — the agent host
(Claude Code, Codex, Gemini, Copilot) running the scenario directly versus the
runner kit owning the loop and calling tools deterministically. The first
paradigm is cheap for ad-hoc developer use but non-replayable; the second is
auditable but requires org-controlled LLM keys and a sandbox.

## Decision

Adopt **two explicit execution modes** at the Profile level:

- `execution_mode: orchestrator` — the runner owns probes/oracles/finding
  emission; the LLM is called only for explicit, scoped tasks (scenario
  generation, semantic_llm_judge, bug minimisation).
- `execution_mode: agent` — the agent host runs the scenario; the runner
  records what the agent reports.

Constraints:

- `release-gate` profiles **must** be `orchestrator`.
- `require_deterministic_replay: true` is illegal in `agent` mode.
- Each Finding carries its `execution_mode` so triage can weight it accordingly.

## Consequences

- Determinism is honest. `agent` mode is documented as best-effort; CI gates
  only consume `orchestrator` runs.
- Cost governance is enforceable: `llm_budget_usd` applies to org-paid runs.
- The methodology stays usable by individual developers (agent mode is still
  there) without inheriting its non-replayable nature into the merge gate.

## Alternatives considered

- **Orchestrator-only.** Rejected: forces developers to wait for CI for every
  exploratory test.
- **Agent-only.** Rejected: makes SOC2 / ISO release-gate audits impossible.
