# GitHub Copilot instructions for `agentic-qa-kit`

> **Read `AGENTS.md` at the repository root first.** It is the canonical source of operating rules, branch strategy, validation loop, and Definition of Done. This file adds Copilot-specific notes only.

## Copilot-specific guidance

- Custom skills (compatible with Copilot CLI) live in `.github/skills/aqa-*/SKILL.md`. Copilot also auto-detects `.claude/skills/` and `.agents/skills/`, so duplication is intentional and adapter-generated.
- Custom agents live in `.github/agents/aqa-*.agent.md`.
- Hooks live in `.github/hooks/*.json`.
- Path-specific instructions can be added under `.github/instructions/*.instructions.md` for narrower scopes (e.g. `packages/admin/**`).

## Copilot Code Review

This repository **requires** Copilot Code Review on every PR. See `AGENTS.md § Branch and PR loop` for the exact request flow (gh CLI + GraphQL fallback).

If you are the human reviewer running Copilot, please:
- Wait for CI green before merging
- Resolve every comment (or mark explicitly as rejected with motivation)
- Update `docs/LESSON.md` if a Copilot comment surfaced a pattern worth remembering

## Permission profile

Same as `AGENTS.md` — read freely, write only inside this repo, no destructive git/gh operations without user approval.
