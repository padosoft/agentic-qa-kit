# Progress

> Live state of the repository. Update after every meaningful work increment (sub-task done, blocker hit, decision made). Entries dated `YYYY-MM-DD`. Newest first.

## How to read this file

- Each dated section is a single working day (or session).
- Bullets are chronological inside a day.
- Each bullet states **what changed**, **why**, and **what's next** where relevant.
- After a session interruption, the last bullet of the latest day is the resume point.

## 2026-05-17

- Started `task/bootstrap-governance` from `main` (commit `c25dd4e` = initial). Goal: stand up the process governance — branch strategy, validation loop, Copilot review automation, docs scaffolding, repo tooling — **before** any product code is written.
- **Task 0 closed.** PR #1 merged (`d9cb4b3`). Tag `v0.0.1-governance` pushed. 8 Copilot review iterations; 52 actionable comments addressed.
- **Task 1 closed.** PR #2 merged (`3871cd1`). `@aqa/schemas` — Zod source of truth + JSON Schema (Draft 2020-12) generated artifacts. Determinism contract from §3.1 codified in `Finding`. Hash-chained audit codified in `Event`. 4 Copilot review passes; 29 actionable comments addressed. Follow-up #3 tracks remaining JSON-Schema parity work.
- **Task 2 closed.** PR #4 merged (`895cec9`). `@aqa/kit` — `aqa` CLI (init/doctor/validate) + project profiler. CI bun + Node 22 jobs aligned to per-package script runner; topological build added (run-workspace-script DFS sort) so downstream packages can resolve workspace imports through dist/.
- **Task 3 closed.** PR #5 merged. `@aqa/pack-loader` + 5 baseline packs (core / api-core / web-ui / llm-agent / security). One Copilot review pass; 15 actionable comments addressed (slug placeholders, manifest descriptions, OWASP coverage scoped to v0.1.0 subset).
- **Task 4 closed.** PR #6 merged. `@aqa/adapters` — Claude, Codex, Gemini, Copilot adapters with per-target capability profiles and deterministic `render(ctx)`.
- **Task 5 closed.** PR #7 merged. `@aqa/runner` — RunLifecycle state machine, hash-chained EventChainWriter (end-to-end verified), FindingsWriter (in-run dedup), built-in oracles, runScenario orchestrator.
- **Task 6 closed.** PR #8 merged. `@aqa/reporter` — Markdown + JSON reporters + 3-level replay artifact generator (repro.sh, repro.curl, repro.playwright.ts).
- **Task 7 — admin panel bootstrap done.** `packages/admin` (`@aqa/admin`, private) — Vite + React 19 + TS strict scaffold with a 12-route sidebar shell (Dashboard, Runs, Findings, Risk map, Profiles, Packs, Scenarios, Agents, Replay, Audit log, Cost, Settings). Each route renders a typed `ScreenPlaceholder` documenting what lands when. Vite build produces `dist/` (197 KB JS, gzip 62 KB). Full Tailwind 4 wiring, TanStack Router migration, and per-screen data wiring are deferred to Task 17 (`task/admin-editing`). 4 node:test tests; 86 repo-wide.
- **Repo health snapshot:** 9 packages (schemas, kit, pack-loader, adapters, runner, reporter, admin + 5 packs), 86 tests passing under both Bun and Node 22, biome + tsc strict zero errors, hash-chained audit verified, JSON Schemas Draft 2020-12 compliant.
- **Next:** Task 8 — `docs/getting-started.md` (junior 15-min onboarding), `docs/architecture/reference.md` (real diagram + component map), `docs/methodology/agentic-qa.md` (Risk/Invariant/Probe/Oracle), ADR-001..ADR-009, examples/bun-api, examples/nextjs-saas, then v0.1.0 release tag. Task 9 (FINAL) — knowledge consolidation across LESSON.md / RULES.md / agent files.
