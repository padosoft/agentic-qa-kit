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
- **Tasks 8 — 22 closed.** v0.1.0 through v0.6.0 tags pushed (#9..#16). Stack grew to 18 packages: schemas, kit, pack-loader, pack-scanner, adapters, llm-adapters, runner, reporter, admin, admin-core, auth, sandbox, store, generator, server, clustering, methodology, + 5 packs. Deploy scaffolds (`deploy/helm`, `deploy/terraform`, `scripts/air-gap-install.sh`) shipped with explicit "v0.6 / v1.0" labels.
- **Task 23 — v1.0 readiness in progress.** `@aqa/compliance` ships SOC2/ISO controls catalog (`CONTROL_MAPPINGS`, `controlsCoverage`) + hash-chain audit verifier (`verifyEventChain`, `aqa-audit-verify` CLI). `docs/compliance/soc2-iso-mapping.md` is the auditor-facing source of truth; `docs/compliance/pen-test-scope.md` is the engagement contract. 7 new tests; 165 repo-wide.
- **v1.1 polish shipped** (PR #18, tag `v1.1.0`). README banner now points to a real PNG. `deploy/helm` is feature-complete (runner StatefulSet w/ per-pod PVC, optional Ingress + TLS, NetworkPolicy that confines runner egress, optional in-cluster Postgres subchart). Three examples: `bun-api`, `nextjs-saas` (session-cookie invariant), `laravel-app` (demonstrates language-agnostic targeting). `docs/LESSON.md` consolidated retrospective. GitHub Releases backfilled for every tag from `v0.0.1-governance` through `v1.1.0`. README pre-alpha badge replaced with GA + Release badges.

## 2026-05-18

- **v1.4 admin API surface (in flight).** Expanded `packages/server`'s `makeApi()` from 4 to 28 routes covering everything `docs/design/admin-panel-spec-v2.md` references: runs detail + events, finding status mutation, packs CRUD, profiles CRUD, risks CRUD, scenarios edit, audit query, cost summary, queue snapshot, notifications, saved views, API tokens, tenancy (orgs + projects). `StoreProvider` extended with matching methods; `MemoryStore` implements all of them (Postgres scaffold throws `not implemented`). New `@aqa/schemas` namespaces: `Notification`, `SavedView`, `ApiToken`, `CostSummary`, `Tenancy`. Multi-tenant via `x-aqa-org` / `x-aqa-project` headers. 8 new tests; 184 repo-wide.
- **Design brief for admin v2 shipped.** `docs/design/admin-panel-spec-v2.md` — self-contained enterprise-grade spec (tokens, 30 screens, full component library, interaction patterns, a11y, perf budget, deliverables checklist) so an external designer (or Claude Design) can build the React template in parallel.
- **Next macro task (post-admin-design).** After admin v2 design lands and integrates: full end-to-end ecosystem smoke via Playwright — boot server + runner pool + admin in a single command, drive a real `aqa run` against `examples/bun-api`, verify findings appear in the admin, verify audit chain remains valid. TDD: any broken path → failing test first, then fix.
- **Issue #3 closed.** Mirrored 3 remaining Zod superRefines into JSON Schema (Finding `status='duplicate' ⇒ duplicate_of`, ReproLevel `deterministic=true ⇒ attempts >= 1`, ProfilesFile `profile.name === key` via `$comment`). Added Ajv 2020 round-trip test (`packages/schemas/test/ajv-roundtrip.test.ts`) that validates every fixture against the emitted schema — catches Zod/JSON-Schema divergence at build time. 204 tests repo-wide. Patches resolve `#/definitions/<name>` indirection emitted by zod-to-json-schema.
- **PR #22 local gates verified (2026-05-18).** `bun install` ✅, `bun run build` ✅, `bun run typecheck` ✅, `bun run lint` ✅ (4 warnings, no errors), `bun test` ✅ 204/204.
- **BLOCKER — Copilot review request (PR #22).** Both `gh pr edit --add-reviewer copilot-pull-request-reviewer` and GraphQL `requestReviewsByLogin` return HTTP 403 (DNS monitoring proxy blocks GitHub API). **Action required:** please open PR #22 in the GitHub UI and manually add `copilot-pull-request-reviewer` from the Reviewers sidebar panel.
- **Final closing step (after every macro task above is closed).** README + docs refresh pass:
  1. Audit every `v0.x.x` reference in `README.md` — replace stale ones with the current shipped surface or drop.
  2. Quick-start section: remove the "preview of v0.1.0" disclaimer; write the definitive end-to-end junior flow that **actually works today**, including booting the web admin panel. No more "this will work in vX" hedging.
  3. Architecture section in `README.md`: refresh diagram + component list to match the 18 packages shipped (schemas, kit, pack-loader, pack-scanner, adapters, llm-adapters, runner, reporter, admin, admin-core, auth, sandbox, store, generator, server, clustering, methodology, compliance).
  4. `docs/`: audit every file, prune obsolete content, keep only current/good. Anything that says "stub" or "lands in vX" must either be filled in or removed.
  5. After "The mental model in 7 words" section, add a new section titled **"How you use it"** — clean, concise, written in the same rhythm as "7 words" — describing the end-to-end junior workflow:
     - `aqa init` (detect repo, scaffold `.aqa/`)
     - edit `risk-map.yaml` (declare what matters)
     - install agent files for your coding agent
     - `aqa run --profile smoke` (skills + scenarios + runner + oracles)
     - open admin panel (`bun --filter @aqa/admin dev`)
     - inspect findings, replay deterministically, verify audit chain
     - iterate on risks + scenarios until release-gate green
  6. Tag the README/docs refresh PR as the official **closure** of the agentic-qa-kit v1.x line.

## 2026-05-18 — earlier

- **v1.2 admin wired.** `@aqa/admin` migrated from inline-style placeholder shell to a real SPA: Tailwind 4 + TanStack Router + TanStack Query + Zustand + lucide-react. 12 screens shipped end-to-end: Dashboard (KPIs), Runs (table), Findings (clustered via content-hash signature, async via Web Crypto), Risk map (grouped by category), Profiles, Packs (with signature badge), Scenarios (pack→scenario tree), Agents (per-agent instruction-file detection), Replay (per-finding repro.sh / repro.curl preview + verify button), Audit log (paste events.jsonl → re-walk the sha256 chain in-browser; "Load good chain" / "Load tampered chain" demo buttons), Cost (bar by profile), Settings (theme toggle).
- **Browser-side hash-chain verifier.** `node:crypto` is not Vite-safe, so the admin re-implements `verifyEventChain` + `signatureOf` on top of `crypto.subtle.digest`. The CLI version in `@aqa/compliance` remains the SOC2 source of truth; the in-browser copy is a UX affordance only. Documented in `docs/LESSON.md`.
- Build: 376 KB JS (116 KB gzip), Tailwind CSS 9.94 KB (2.92 KB gzip). 165 tests still pass.
