# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-05-17

### Added — knowledge consolidation (Task 9)

- `docs/LESSON.md` — v0.1.0 retrospective entries: workspace topology, dual-runtime testing, pre-build before typecheck, generated-artifact ignore, JSON-Schema `if/then` lint trap, Copilot review stopping criterion, slug regex flag survival, hash chain invariant, determinism gating placement.
- `docs/RULES.md` — added "Workspace topology rules" and "Determinism + audit rules" sections so the v0.1.0 patterns become enforceable conventions.
- Test runner default in `RULES.md` updated from `bun:test`/Vitest to `node:test` + `assert/strict` import-from-`dist/` (single source, runs identically under Bun and Node 22).

## [0.1.0] — 2026-05-17

### Added — v0.1.0 milestone

**Schemas (Task 1)** — `@aqa/schemas`: Zod source of truth + JSON Schema (Draft 2020-12) generated artifacts. Domains: Project, Profile, ProfilesFile, RiskMap, Scenario, Finding, Event, Run, PackManifest. Determinism contract (3-level reproducibility + verification-floor gating) and hash-chained audit shape codified.

**CLI (Task 2)** — `@aqa/kit`: `aqa init` / `aqa doctor` / `aqa validate`. Project profiler detects runtime, package manager, framework, DB, LLM SDK, test runner, SUT type from package.json + filesystem signals.

**Packs (Task 3)** — `@aqa/pack-loader` + five baseline packs (`core`, `api-core`, `web-ui`, `llm-agent`, `security`). `applies_when` predicate with 6-clause AND semantics.

**Adapters (Task 4)** — `@aqa/adapters` renders per-host instruction files and skills for Claude, Codex, Gemini, GitHub Copilot.

**Runner (Task 5)** — `@aqa/runner`: `RunLifecycle` state machine, `EventChainWriter` (hash-chained `events.jsonl`), `FindingsWriter` (in-run dedup), 3 built-in oracles, `runScenario()` orchestrator.

**Reporter (Task 6)** — `@aqa/reporter`: Markdown + JSON reporters + 3-level replay artifacts (`repro.sh`, `repro.curl`, `repro.playwright.ts`).

**Admin panel (Task 7)** — `@aqa/admin` (private): Vite + React 19 + TS strict scaffold with 12-route sidebar.

**Docs (Task 8)** — `getting-started.md`, `ecosystem-explained.md`, `architecture/reference.md`, `methodology/agentic-qa.md` filled in; ADRs 001-005 written (dual execution mode, three-level replay, hash-chained audit, Zod as source of truth, Bun-first with Node 22 fallback).

### Test surface

86 tests pass under both Bun and Node 22 (`--experimental-strip-types`). All Zod validators have round-trip golden fixtures (valid + invalid). Hash chain end-to-end verified.

### Out of scope (tracked as follow-ups, post-v0.1)

- Real HTTP/shell/Playwright/SQL probe drivers in the runner.
- Template render engine + `aqa generate --packs ...` CLI command.
- Tailwind 4 wiring + TanStack Router migration in the admin panel.
- HTML / SARIF reporters and agent-level replay.
- `aqa install-agent-files` CLI command that writes the rendered adapter files to disk.
- JSON-Schema parity for the remaining cross-field superRefines (#3).

## [0.0.1-governance] — 2026-05-17

### Added — Bootstrap (Task 0)

- Process governance docs: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`.
- `docs/RULES.md` (UI/UX, security, testing, doc, review, code style, git workflow).
- `docs/PROGRESS.md` and `docs/LESSON.md` templates.
- `docs/adr/README.md` with ADR template and index of 10 critical ADRs.
- `docs/design/admin-panel-template.md` — complete admin UI spec for parallel template work.
- `docs/getting-started.md` — junior-friendly onboarding skeleton.
- `docs/ecosystem-explained.md` — concept introduction skeleton.
- Skills: `.agents/skills/aqa-process-loop`, `.agents/skills/aqa-self-resume` (mirrored to `.claude/`, `.gemini/`, `.github/`).
- Repo scaffolding: `package.json` (Bun workspaces), `tsconfig.base.json`, `biome.json`, `bunfig.toml`, `.editorconfig`, `.gitignore`, `.gitattributes`, `.nvmrc`, `.bun-version`.
- CI: `.github/workflows/ci.yml` (typecheck + lint + unit + node-compat + build + e2e gates).
- Copilot review automation: `.github/workflows/copilot-review.yml` (with GraphQL fallback).
- GitHub templates: `CODEOWNERS`, `pull_request_template.md`, `ISSUE_TEMPLATE/{bug,feature,security}.yml`.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`.
- `README.md` rewritten with enterprise badges, TOC, features, quick start.

[Unreleased]: https://github.com/padosoft/agentic-qa-kit/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/padosoft/agentic-qa-kit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/padosoft/agentic-qa-kit/compare/v0.0.1-governance...v0.1.0
[0.0.1-governance]: https://github.com/padosoft/agentic-qa-kit/releases/tag/v0.0.1-governance
