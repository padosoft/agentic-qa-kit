# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] — 2026-05-18

### Added — quality polish (no new packages)

- **Admin server integration.** New `packages/admin/src/data/api.ts` fetches from `VITE_AQA_SERVER_URL` (real `@aqa/server`'s `makeApi()` shape) with automatic fallback to in-bundle mock fixtures. Screens show a `live` or `mock` badge so operators see at a glance which mode they're in.
- **Admin sub-screens.** 6 detail routes wired: `/runs/$runId`, `/findings/$findingId`, `/risk-map/$riskId`, `/profiles/$profileName`, `/packs/$packSlug`, `/scenarios/$scenarioId`. Each with `Breadcrumb` + `PageHeader`.
- **Admin unit tests.** `test/audit.test.ts` (5 tests: `parseEventLines` ×2, `verifyEventChain` ×3) + `test/cluster.test.ts` (6 tests) cover the in-browser Web Crypto verifier and signature clusterer. Tests run unchanged on Node 22 because `crypto.subtle` is global there.
- **CLI E2E smoke.** `scripts/e2e-cli.mjs` exercises `aqa --version`, `aqa --help`, `aqa doctor`, `aqa validate` against `examples/bun-api`. Wired as `bun run test:e2e-cli`.
- **`docs/security/threat-model.md`** expanded from 12-line stub to full STRIDE catalog: trust boundaries diagram, 20 threats with severity + current mitigation + status, agentic-specific cross-cutting threats, pen-test cadence link.
- **`docs/architecture/reference.md`** updated with the v0.2 → v1.2 component summary + per-component file paths + adjacent docs index.

## [1.2.0] — 2026-05-18 — Admin SPA wired

Tailwind 4 + TanStack Router (code-based) + TanStack Query + Zustand + lucide-react + date-fns. 12 screens (Dashboard, Runs, Findings clustered via content-hash signature, Risk map, Profiles, Packs, Scenarios, Agents, Replay, Audit log, Cost, Settings). Audit log re-walks the sha256 prev_hash chain in-browser via `crypto.subtle` (mirrors `@aqa/compliance`'s `verifyEventChain`). Theme toggle persisted to localStorage. Bundle: 376 KB JS (116 KB gzip), 9.94 KB CSS (2.92 KB gzip). PR #19.

## [1.1.0] — 2026-05-17 — Polish

Banner image wired in README; `Status: pre-alpha` badge replaced with GA + Release badges. `deploy/helm` upgraded from scaffold to feature-complete: server Deployment + Service, runner StatefulSet with per-pod PVC, optional Ingress + TLS, NetworkPolicy that confines runner egress, optional in-cluster Postgres subchart. Three examples: `examples/bun-api`, `examples/nextjs-saas` (session-cookie invariant), `examples/laravel-app` (PHP / Laravel — demonstrates language-agnostic AQA targeting). `docs/LESSON.md` consolidated v1.0 → v1.1 retrospective. GitHub Releases backfilled for every tag from `v0.0.1-governance` through `v1.1.0`. PR #18.

## [1.0.0] — 2026-05-17 — GA: SOC2/ISO readiness (Task 23)

`@aqa/compliance` — SOC2 TSC + ISO 27001:2022 Annex A controls catalog (`CONTROL_MAPPINGS`), `controlsCoverage()` summarizer, `verifyEventChain(events)` hash-chain verifier, `aqa-audit-verify <path>` CLI (non-zero exit on chain break). `docs/compliance/soc2-iso-mapping.md` (auditor source of truth), `docs/compliance/pen-test-scope.md` (engagement contract). Closes the 24-task roadmap. PR #17.

## [0.6.0] — 2026-05-17 — Methodology + deploy assets (Tasks 21, 22)

`@aqa/methodology` — STRIDE / FMEA / OWASP risk mapping. `strideOf`, `fmeaScore` (RPN = severity × occurrence × detection), `owaspOf`, `methodologyCheck` (flags risks without any framework anchor — auditor smell). `deploy/helm` chart skeleton, `deploy/terraform` namespace module, `scripts/air-gap-install.sh` (bundle + verify). PR #16.

## [0.5.0] — 2026-05-17 — Multi-team + clustering (Tasks 19, 20)

`@aqa/server` — framework-agnostic `makeApi()` routing table + `RunnerQueue` (FIFO with visibility leases). `@aqa/clustering` — `signatureOf` (sha256 of scenario × risk × normalised summary) + `clusterFindings` (representative = earliest, severity = worst). PR #15.

## [0.4.0] — 2026-05-17 — Admin editing + AI generation (Tasks 17, 18)

`@aqa/admin-core` — `OptimisticEditor<T>` (propose / commit / rollback) + `detectConflict` (no-change / identical / conflict). `@aqa/generator` — `ReviewQueue` with terminal-state guards (pending → approved / rejected). `proposeScenarios` via LLM with `Scenario.safeParse` drop. PR #14.

## [0.3.0] — 2026-05-17 — Enterprise table-stakes (Tasks 13-16)

`@aqa/store` — `StoreProvider` interface, `MemoryStore`, `PostgresStore` scaffold. `@aqa/auth` — `User` / `Role` / `Permission` Zod schemas, `rolePermissions`, `allows()`, OIDC adapter scaffold. `@aqa/pack-scanner` — rejects unsigned ≥1.0, always-on-shell packs, templates without risks; cosign-compatible `verifySignature`. `@aqa/llm-adapters` — `LlmAdapter`, `FixtureAdapter` (content-hash keyed), `ScaffoldAdapter` for live providers. PR #13.

## [0.2.0] — 2026-05-17 — Determinism + cost + sandbox (Tasks 10, 11, 12)

`@aqa/runner` determinism + 3-level replay — `repro.sh`, `repro.curl`, `repro.playwright.ts` per finding; L3 same-bytes reproducibility for findings tagged `verification_floor=high`. `aqa verify <finding-id>` re-runs a finding. `@aqa/cost` — `BudgetTracker` + `defaultPricing`; server refuses to start with budget=0 (fail-safe). `@aqa/sandbox` — `ProcessSandbox` + `ContainerSandbox` scaffold + `selectSandbox`. PR #12.

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
