# Progress

> Live state of the repository. Update after every meaningful work increment (sub-task done, blocker hit, decision made). Entries dated `YYYY-MM-DD`. Newest first.

## How to read this file

- Each dated section is a single working day (or session).
- Bullets are chronological inside a day.
- Each bullet states **what changed**, **why**, and **what's next** where relevant.
- After a session interruption, the last bullet of the latest day is the resume point.

## 2026-05-17

- Started `task/bootstrap-governance` from `main` (commit `c25dd4e` = initial). Goal: stand up the process governance — branch strategy, validation loop, Copilot review automation, docs scaffolding, repo tooling — **before** any product code is written.
- Wrote `AGENTS.md` as the single source of truth for any AI agent (Claude/Codex/Gemini/Copilot). Captured operating rules, stack defaults, security rules, branch and PR loop (with the GraphQL Copilot fallback from the reference repo `product_image_discovery_admin`), Definition of Done, sub-agent context handoff, self-resume protocol.
- Wrote `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md` as thin delegators to `AGENTS.md` plus agent-specific notes (skill activation, permission profile, self-resume).
- Wrote `docs/RULES.md` with implementation defaults table, UI rules (density / no nested cards / radius ≤ 8px / dark mode mandatory), security rules (pre-write redaction, sandbox not optional, pack execution risk), testing rules (coverage ≥ 80% on new code), documentation rules, review rules, code style, commit style, git workflow.
- Completed Task 0 in one pass: repo scaffolding (`package.json` Bun workspaces, `tsconfig.base.json`, `biome.json`, `bunfig.toml`, `.editorconfig`, `.gitignore`, `.gitattributes`, `.nvmrc`, `.bun-version`).
- CI workflow `.github/workflows/ci.yml` with jobs: meta (markdown link check), typecheck+lint, unit tests (Bun + Node), build, e2e (Playwright). Placeholder gates pass while packages don't exist yet.
- Copilot review automation `.github/workflows/copilot-review.yml` with gh CLI fast-path + GraphQL fallback (per AGENTS.md).
- GitHub templates: CODEOWNERS, pull_request_template (DoD checklist), ISSUE_TEMPLATE bug/feature/security.
- Skills `aqa-process-loop` + `aqa-self-resume` mirrored across `.agents/`, `.claude/`, `.gemini/`, `.github/skills/`.
- Long-form docs: `docs/design/admin-panel-template.md` (full UI spec for parallel template work, 25 screens, tech stack, design tokens, wireframes), `docs/getting-started.md` (junior onboarding skeleton), `docs/ecosystem-explained.md` (concepts skeleton), `docs/adr/README.md` (ADR template + index of 10 critical ADRs), `docs/implementation-plan.md` (full enterprise blueprint copied from durable plan).
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md` (with 0.0.1-governance entry).
- `README.md` rewritten enterprise-wow (badges, TOC, features, junior-friendly quick start, multi-agent matrix, architecture, roadmap, status, docs links).
- Local gates green (`bun run lint`, `bun run typecheck`, `bun run test`, `bun run build` — placeholders while packages are empty).
- Next step: commit, push `task/bootstrap-governance`, open PR → `main`, assign Copilot reviewer, wait for CI green, merge, tag `v0.0.1-governance`, then start Task 1 — schemas package.
